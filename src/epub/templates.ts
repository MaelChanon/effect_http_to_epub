export const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" })[c]!)

export const MIMETYPE = "application/epub+zip"

export const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>`

export const styleCss = "@page {\nmargin: 0;\n}\nbody {\ndisplay: block;\nmargin: 0;\npadding: 0;\n}\n"

export const styleHacksCss = "div#book-inner {\n\tmargin-top: 0;\n\tmargin-bottom: 0;\n}\n"

// Kobo's KEPUB renderer expects what kepubify adds to every content document:
// a style block, the book-columns/book-inner wrappers and a koboSpan around each image.
export const koboStyleHacks =
  "<style type=\"text/css\" class=\"kobostylehacks\">div#book-inner { margin-top: 0; margin-bottom: 0;}</style>"

export const pageXhtml = (name: string, w: number, h: number, tag: string, vol: string, kepub = false) => {
  const img = `<img width="${w}" height="${h}" src="../../../Images/${tag}/${vol}/${name}.jpg"/>`
  const content = `<div style="text-align:center;top:0.0%;"><span>
    ${kepub ? `<span class="koboSpan" id="kobo.1.1">${img}</span>` : img}
  </span></div>`
  return `<?xml version='1.0' encoding='utf-8'?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <title>${name}</title>
    <link href="../../style.css" type="text/css" rel="stylesheet"/>
    <meta name="viewport" content="width=${w}, height=${h}"/>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
    <link rel="stylesheet" href="../../../../kte-css/stylehacks.css"/>${kepub ? `\n    ${koboStyleHacks}` : ""}
  </head>
  <body style="background-color:#000000;">${kepub ? `<div id="book-columns"><div id="book-inner">${content}</div></div>` : content}</body></html>`
}

export const manifestFooter = `
<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="Text/style.css" media-type="text/css"/>
<item id="cover" href="Images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
<item id="id1" href="../kte-css/stylehacks.css" media-type="text/css"/>`

export const contentOpf = (p: {
  title: string
  creator: string
  uuid: string
  uuid2: string
  lang: string
  manifest: string
  spine: string
  modified: string
}) => {
  const title = escapeXml(p.title)
  const creator = escapeXml(p.creator)
  return `<?xml version='1.0' encoding='utf-8'?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookID">
<metadata xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title id="id">${title}</dc:title>
<dc:creator id="id-1">${creator}</dc:creator>
<dc:identifier>uuid:${p.uuid2}</dc:identifier>
<dc:identifier id="BookID">urn:uuid:${p.uuid}</dc:identifier>
<dc:language>${escapeXml(p.lang)}</dc:language>
<meta property="dcterms:modified">${p.modified}</meta>
<meta refines="#id" property="title-type">main</meta>
<meta refines="#id" property="file-as">${title}</meta>
<meta name="cover" content="cover"/>
<meta property="rendition:orientation">portrait</meta>
<meta property="rendition:spread">landscape</meta>
<meta property="rendition:layout">pre-paginated</meta>
<meta refines="#id-1" property="role" scheme="marc:relators">aut</meta>
<meta refines="#id-1" property="file-as">${creator}</meta>
</metadata>
<manifest>
${p.manifest}</manifest>
<spine page-progression-direction="rtl" toc="ncx">
${p.spine}</spine>
</package>`
}

export const tocNcx = (uuid: string, title: string, entries: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<ncx version="2005-1" xml:lang="en-US" xmlns="http://www.daisy.org/z3986/2005/ncx/">
<head>
<meta name="dtb:uid" content="urn:uuid:${uuid}"/>
<meta name="dtb:depth" content="1"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
<meta name="generated" content="true"/>
</head>
<docTitle><text>${escapeXml(title)}</text></docTitle>
<navMap>
${entries}</navMap>
</ncx>`

// kepubify numbers koboSpans per block: one paragraph per <ol>, one segment per label.
const koboSpans = (items: string, paragraph: number) => {
  let segment = 0
  return items.replace(
    /<span>([^<]*)<\/span>/g,
    (_, label) => `<span><span class="koboSpan" id="kobo.${paragraph}.${++segment}">${label}</span></span>`
  )
}

export const navXhtml = (title: string, toc: string, pageList: string, kepub = false) =>
  `<?xml version='1.0' encoding='utf-8'?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escapeXml(title)}</title>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<link rel="stylesheet" href="../kte-css/stylehacks.css"/>${kepub ? `\n${koboStyleHacks}` : ""}
</head>
<body><div id="book-columns"><div id="book-inner">
<nav epub:type="toc" id="toc"><ol>${kepub ? koboSpans(toc, 1) : toc}</ol></nav>
<nav epub:type="page-list"><ol>${kepub ? koboSpans(pageList, 2) : pageList}</ol></nav>
</div></div></body>
</html>`
