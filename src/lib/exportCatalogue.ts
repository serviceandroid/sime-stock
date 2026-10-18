import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { supabase } from './supabase'

type Product = {
  id: string
  name: string
  category_id: string | null
  brand_id: string | null
  short_description: string | null
  description: string | null
  technical_details: string | null
  usage_instructions: string | null
  safety_notes: string | null
}

type Lookup = {
  id: string
  name: string
}

type Variant = {
  id: string
  product_id: string
  reference: string
  label: string | null
  sales_unit: string | null
  old_price: number | null
  current_price: number | null
}

type ProductImage = {
  id: string
  product_id: string
  storage_path: string
  is_primary: boolean
}

type Company = {
  name: string | null
  description: string | null
  address: string | null
  phone_primary: string | null
  phone_secondary: string | null
  email: string | null
  website: string | null
  logo_path: string | null
  currency: string
}

type PdfImage = {
  data: string
  width: number
  height: number
}

export type CatalogueOptions = {
  showPrices: boolean
  onProgress?: (message: string) => void
}

export type CatalogueResult = {
  productCount: number
  warnings: string[]
}

type PdfWithTable = jsPDF & {
  lastAutoTable?: {
    finalY: number
  }
}

// Évite les espaces insécables et certaines ponctuations
// mal rendues par les polices PDF standard.
function clean(value: string): string {
  return value
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
}

async function fetchRows<T>(
  table: string,
  columns: string,
  activeOnly = false,
): Promise<T[]> {
  const rows: T[] = []
  const batchSize = 500
  let offset = 0

  while (true) {
    let query = supabase
      .from(table)
      .select(columns)
      .order('id')
      .range(offset, offset + batchSize - 1)

    if (table === 'products') {
      query = query.eq('status', 'active')
    }

    if (activeOnly) {
      query = query.eq('is_active', true)
    }

    const { data, error } = await query

    if (error) throw error
    if (!data) {
      throw new Error(`Réponse incomplète pour ${table}.`)
    }

    rows.push(...(data as unknown as T[]))

    if (data.length < batchSize) break
    offset += batchSize
  }

  return rows
}

// Convertit aussi les images WebP en JPEG pour le PDF.
// La taille est réduite pour limiter le poids du catalogue.
async function loadPdfImage(
  bucket: string,
  path: string,
): Promise<PdfImage> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .download(path)

  if (error) throw error
  if (!data) throw new Error('Image introuvable.')

  const url = URL.createObjectURL(data)

  try {
    const image = new Image()

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Image illisible.'))
      image.src = url
    })

    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error('Dimensions de l’image invalides.')
    }

    const scale = Math.min(
      1,
      1400 / Math.max(image.naturalWidth, image.naturalHeight),
    )

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))

    const context = canvas.getContext('2d')
    if (!context) throw new Error('Conversion de l’image impossible.')

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    return {
      data: canvas.toDataURL('image/jpeg', 0.85),
      width: canvas.width,
      height: canvas.height,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function placeImage(
  doc: jsPDF,
  image: PdfImage,
  x: number,
  y: number,
  boxWidth: number,
  boxHeight: number,
) {
  const scale = Math.min(
    boxWidth / image.width,
    boxHeight / image.height,
  )

  const width = image.width * scale
  const height = image.height * scale

  doc.addImage(
    image.data,
    'JPEG',
    x + (boxWidth - width) / 2,
    y + (boxHeight - height) / 2,
    width,
    height,
  )
}

export async function exportCatalogue(
  options: CatalogueOptions,
): Promise<CatalogueResult> {
  const progress = (text: string) => options.onProgress?.(text)
  const warnings: string[] = []

  progress('Chargement des informations commerciales…')

  // Seuls les champs utiles au catalogue sont demandés :
  // aucune note interne ni aucun prix d’achat.
  const [
    companyResponse,
    products,
    categories,
    brands,
    variants,
    images,
  ] = await Promise.all([
    supabase
      .from('company_settings')
      .select(
        'name, description, address, phone_primary, phone_secondary, email, website, logo_path, currency',
      )
      .eq('id', 1)
      .single(),

    fetchRows<Product>(
      'products',
      'id, name, category_id, brand_id, short_description, description, technical_details, usage_instructions, safety_notes',
    ),

    fetchRows<Lookup>('categories', 'id, name'),
    fetchRows<Lookup>('brands', 'id, name'),

    fetchRows<Variant>(
      'product_variants',
      options.showPrices
        ? 'id, product_id, reference, label, sales_unit, old_price, current_price'
        : 'id, product_id, reference, label, sales_unit',
      true,
    ),

    fetchRows<ProductImage>(
      'product_images',
      'id, product_id, storage_path, is_primary',
    ),
  ])

  if (companyResponse.error) throw companyResponse.error
  if (!companyResponse.data) {
    throw new Error('Les coordonnées de l’entreprise sont introuvables.')
  }

  if (products.length === 0) {
    throw new Error(
      'Aucun produit actif à exporter. Passez au moins une fiche au statut Actif.',
    )
  }

  const company = companyResponse.data as Company
  const companyName = company.name?.trim() || 'SIME'
  const categoryMap = new Map(categories.map((item) => [item.id, item.name]))
  const brandMap = new Map(brands.map((item) => [item.id, item.name]))

  const variantsByProduct = new Map<string, Variant[]>()

  for (const variant of variants) {
    const list = variantsByProduct.get(variant.product_id) || []
    list.push(variant)
    variantsByProduct.set(variant.product_id, list)
  }

  const imageByProduct = new Map<string, ProductImage>()

  for (const image of images) {
    const previous = imageByProduct.get(image.product_id)

    // En l’absence de photo principale, prend une photo disponible.
    if (!previous || image.is_primary) {
      imageByProduct.set(image.product_id, image)
    }
  }

  function categoryName(product: Product): string {
    return product.category_id
      ? categoryMap.get(product.category_id) || 'Sans catégorie'
      : 'Sans catégorie'
  }

  products.sort(
    (a, b) =>
      categoryName(a).localeCompare(categoryName(b), 'fr') ||
      a.name.localeCompare(b.name, 'fr') ||
      a.id.localeCompare(b.id),
  )

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  }) as PdfWithTable

  doc.setProperties({
    title: `Catalogue ${companyName}`,
    subject: 'Catalogue commercial',
    author: companyName,
    creator: 'SIME Stock',
  })

  const margin = 18
  const pageWidth = 210
  const contentWidth = pageWidth - margin * 2
  const bottomLimit = 273
  let y = 24

  function newPage() {
    doc.addPage()
    y = 24
  }

  function ensureSpace(height: number) {
    if (y + height > bottomLimit) newPage()
  }

  function writeText(
    text: string,
    size = 10,
    bold = false,
  ) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(30, 48, 66)

    const lineHeight = size * 0.3528 * 1.45
    const paragraphs = clean(text).split(/\r?\n/)

    for (const paragraph of paragraphs) {
      const lines = doc.splitTextToSize(
        paragraph || ' ',
        contentWidth,
      ) as string[]

      for (const line of lines) {
        ensureSpace(lineHeight)
        doc.text(line, margin, y)
        y += lineHeight
      }
    }

    y += 3
  }

  function writeSection(title: string, value: string | null) {
    if (!value?.trim()) return

    ensureSpace(20)
    writeText(title, 11, true)
    writeText(value)
    y += 2
  }

  function formatPrice(value: number | null): string {
    if (value === null || value === undefined) return 'Sur demande'

    const amount = clean(
      new Intl.NumberFormat('fr-FR', {
        maximumFractionDigits: 2,
      }).format(Number(value)),
    )

    return `${amount} ${company.currency === 'XOF' ? 'FCFA' : company.currency}`
  }

  // Couverture.
  if (company.logo_path) {
    try {
      const logo = await loadPdfImage('company-assets', company.logo_path)
      placeImage(doc, logo, margin, 22, 65, 25)
      y = 62
    } catch {
      warnings.push('Le logo n’a pas pu être intégré.')
    }
  }

  writeText(companyName, 25, true)
  writeText('CATALOGUE PRODUITS ET MATÉRIELS', 15, true)
  y += 7

  if (company.description) writeText(company.description, 11)

  writeText(`${products.length} fiche(s) produit`, 11)
  writeText(
    `Édition du ${new Date().toLocaleDateString('fr-FR')}`,
    10,
  )

  y += 10

  const contacts = [
    company.address,
    company.phone_primary,
    company.phone_secondary,
    company.email,
    company.website,
  ]
    .filter((value): value is string => !!value?.trim())
    .join('\n')

  writeSection('Contact', contacts || null)

  writeText(
    options.showPrices
      ? 'Prix présentés à la date de génération. Contactez-nous pour confirmer les conditions commerciales.'
      : 'Catalogue sans prix. Contactez-nous pour une offre commerciale.',
    9,
  )

  // Une fiche démarre sur une nouvelle page.
  // Les descriptions longues et les tableaux peuvent continuer
  // sur les pages suivantes sans être tronqués.
  for (const [index, product] of products.entries()) {
    progress(`Préparation du produit ${index + 1}/${products.length}…`)

    newPage()
    writeText(categoryName(product).toLocaleUpperCase('fr'), 10, true)
    writeText(product.name, 20, true)

    const brand = product.brand_id
      ? brandMap.get(product.brand_id)
      : null

    if (brand) writeText(`Marque : ${brand}`, 10)

    const photo = imageByProduct.get(product.id)

    ensureSpace(78)

    if (photo) {
      try {
        const image = await loadPdfImage(
          'product-images',
          photo.storage_path,
        )

        placeImage(doc, image, margin, y, contentWidth, 70)
      } catch {
        warnings.push(`Photo non chargée : ${product.name}.`)
        doc.setFontSize(10)
        doc.setTextColor(100, 110, 120)
        doc.text(
          'Photo indisponible',
          pageWidth / 2,
          y + 35,
          { align: 'center' },
        )
      }
    } else {
      warnings.push(`Aucune photo : ${product.name}.`)
      doc.setFontSize(10)
      doc.setTextColor(100, 110, 120)
      doc.text(
        'Photo non renseignée',
        pageWidth / 2,
        y + 35,
        { align: 'center' },
      )
    }

    y += 78

    writeSection('Présentation', product.short_description)
    writeSection('Description', product.description)
    writeSection('Caractéristiques techniques', product.technical_details)
    writeSection('Conseils d’utilisation', product.usage_instructions)
    writeSection('Précautions d’emploi', product.safety_notes)

    const productVariants = variantsByProduct.get(product.id) || []

    productVariants.sort((a, b) =>
      a.reference.localeCompare(b.reference, 'fr'),
    )

    if (productVariants.length > 0) {
      ensureSpace(32)
      writeText('Formats de vente', 11, true)

      const head = ['Référence', 'Présentation', 'Unité de vente']

      if (options.showPrices) {
        head.push('Ancien prix', 'Prix actuel')
      }

      const body = productVariants.map((variant) => {
        const row = [
          clean(variant.reference),
          clean(variant.label || '-'),
          clean(variant.sales_unit || 'À préciser'),
        ]

        if (options.showPrices) {
          row.push(
            variant.old_price === null ||
              variant.old_price === undefined
              ? '-'
              : formatPrice(variant.old_price),
            formatPrice(variant.current_price),
          )
        }

        return row
      })

      autoTable(doc, {
        startY: y,
        head: [head],
        body,
        theme: 'striped',
        margin: {
          top: 24,
          right: margin,
          bottom: 24,
          left: margin,
        },
        styles: {
          font: 'helvetica',
          fontSize: 8,
          cellPadding: 3,
          overflow: 'linebreak',
          textColor: [30, 48, 66],
        },
        headStyles: {
          fillColor: [23, 63, 101],
          textColor: [255, 255, 255],
        },
        alternateRowStyles: {
          fillColor: [243, 247, 251],
        },
        rowPageBreak: 'avoid',
      })

      y = (doc.lastAutoTable?.finalY || y) + 8
    } else {
      writeText(
        'Formats de vente : contactez-nous pour plus d’informations.',
        9,
      )
    }

    // Laisse au navigateur le temps de mettre à jour la progression.
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0)
    })
  }

  progress('Finalisation du document…')

  const pageCount = doc.getNumberOfPages()

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    doc.setPage(pageNumber)
    doc.setDrawColor(220, 228, 236)
    doc.line(margin, 279, pageWidth - margin, 279)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(90, 105, 120)

    const footerName = doc.splitTextToSize(
      clean(companyName),
      120,
    ) as string[]

    doc.text(footerName[0] || 'Catalogue', margin, 286)
    doc.text(
      `${pageNumber} / ${pageCount}`,
      pageWidth - margin,
      286,
      { align: 'right' },
    )
  }

  const date = new Date()
  const dateLabel = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')

  await doc.save(`Catalogue-SIME-${dateLabel}.pdf`, {
    returnPromise: true,
  })

  return {
    productCount: products.length,
    warnings,
  }
}