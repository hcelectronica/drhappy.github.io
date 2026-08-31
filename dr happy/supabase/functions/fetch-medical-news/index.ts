import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'

type NewsItem = {
  id: string
  source: string
  title: string
  summary: string
  link: string
  publishedAt: string
  imageUrl: string
}

const WHO_FEED_URL = 'https://www.who.int/rss-feeds/news-spanish.xml'
const WHO_FALLBACK_IMAGE =
  'https://cdn.who.int/media/images/default-source/imported/world-health-day-2025/uhc_2025_social-share5a5649a0-fe23-4f72-a42b-67a6c17fd4d5.tmb-1200v.jpg'
const MINISTRY_NEWS_URL = 'https://www.argentina.gob.ar/salud/noticias'
const MINISTRY_FALLBACK_IMAGE = 'https://www.argentina.gob.ar/sites/default/files/argentina-fb.png'

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function decodeHtml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function normalizeText(value: string): string {
  return decodeHtml(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function absoluteUrl(url: string, base: string): string {
  return new URL(url, base).toString()
}

function readXmlTag(block: string, tagName: string): string {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(block)
  return match?.[1]?.trim() ?? ''
}

function readXmlLink(block: string): string {
  const inlineLink = readXmlTag(block, 'link')
  if (inlineLink && !inlineLink.includes('<')) {
    return normalizeText(inlineLink)
  }

  const attributeLink = /<link\b[^>]*href="([^"]+)"[^>]*\/?>/i.exec(block)
  return attributeLink?.[1]?.trim() ?? ''
}

function readMetaContent(html: string, propertyName: string): string {
  const metaMatch = new RegExp(
    `<meta[^>]+(?:property|name)=["']${propertyName}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i',
  ).exec(html)

  return metaMatch?.[1]?.trim() ?? ''
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'dr-happy-news/1.0',
      Accept: 'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
    },
  })

  if (!response.ok) {
    throw new Error(`No se pudo leer ${url}: ${response.status}`)
  }

  return await response.text()
}

async function fetchWhoImage(articleUrl: string): Promise<string> {
  const html = await fetchText(articleUrl)
  const ogImage = readMetaContent(html, 'og:image')
  return ogImage ? absoluteUrl(ogImage, articleUrl) : WHO_FALLBACK_IMAGE
}

async function fetchWhoNews(): Promise<NewsItem[]> {
  const xml = await fetchText(WHO_FEED_URL)
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []

  const baseItems = blocks
    .map((block, index) => {
      const title = normalizeText(readXmlTag(block, 'title'))
      const summary = normalizeText(
        readXmlTag(block, 'description') ||
          readXmlTag(block, 'summary') ||
          readXmlTag(block, 'content'),
      )
      const link = readXmlLink(block)
      const publishedAt = normalizeText(
        readXmlTag(block, 'pubDate') ||
          readXmlTag(block, 'published') ||
          readXmlTag(block, 'updated'),
      )

      if (!title || !link) {
        return null
      }

      return {
        id: `oms-${index}`,
        source: 'OMS',
        title,
        summary,
        link,
        publishedAt,
      }
    })
    .filter((item): item is Omit<NewsItem, 'imageUrl'> => Boolean(item))
    .slice(0, 5)

  const detailResults = await Promise.allSettled(
    baseItems.map((item) => fetchWhoImage(item.link)),
  )

  return baseItems.map((item, index) => ({
    ...item,
    imageUrl:
      detailResults[index]?.status === 'fulfilled'
        ? detailResults[index].value
        : WHO_FALLBACK_IMAGE,
  }))
}

function parseMinistryNewsList(html: string): NewsItem[] {
  const blocks = html.match(/<a href="\/noticias\/[\s\S]*?<\/a>\s*<\/div>/gi) ?? []

  return blocks
    .map((block, index) => {
      const hrefMatch = /<a href="([^"]+)" class="panel panel-default">/i.exec(block)
      const imageMatch = /background-image:url\(([^)]+)\)/i.exec(block)
      const dateMatch = /<time datetime=['"]([^'"]+)['"][^>]*>([^<]+)<\/time>/i.exec(block)
      const titleMatch = /<h3>([\s\S]*?)<\/h3>/i.exec(block)
      const summaryMatch = /<p class="text-muted">\s*<p>([\s\S]*?)<\/p>\s*<\/p>/i.exec(block)

      if (!hrefMatch || !titleMatch) {
        return null
      }

      const href = absoluteUrl(hrefMatch[1], 'https://www.argentina.gob.ar')
      const imageUrl = imageMatch?.[1] ? absoluteUrl(imageMatch[1], href) : MINISTRY_FALLBACK_IMAGE
      const publishedAt = dateMatch?.[1]?.replace(' ', 'T') ?? ''

      return {
        id: `msal-${index}`,
        source: 'Ministerio de Salud de la Nación',
        title: normalizeText(titleMatch[1]),
        summary: normalizeText(summaryMatch?.[1] ?? ''),
        link: href,
        publishedAt,
        imageUrl,
      }
    })
    .filter((item): item is NewsItem => Boolean(item))
    .slice(0, 5)
}

async function fetchMinistryNews(): Promise<NewsItem[]> {
  const html = await fetchText(MINISTRY_NEWS_URL)
  return parseMinistryNewsList(html)
}

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse(405, { message: 'Method not allowed.' })
  }

  const [whoResult, ministryResult] = await Promise.allSettled([
    fetchWhoNews(),
    fetchMinistryNews(),
  ])

  const items = [
    ...(whoResult.status === 'fulfilled' ? whoResult.value : []),
    ...(ministryResult.status === 'fulfilled' ? ministryResult.value : []),
  ]
    .sort((left, right) => {
      const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0
      const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0
      return rightTime - leftTime
    })
    .slice(0, 10)

  if (items.length === 0) {
    const errors = [whoResult, ministryResult]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => (result.reason instanceof Error ? result.reason.message : 'Error desconocido'))

    return jsonResponse(502, {
      message: 'No fue posible obtener noticias oficiales.',
      errors,
    })
  }

  return jsonResponse(200, { items })
})
