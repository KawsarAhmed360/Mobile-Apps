import { Capacitor, registerPlugin } from '@capacitor/core';
import { jsPDF } from 'jspdf';
import type { ShopDocument } from '../shared/document.js';
import { mediaUrl } from './api.js';
import bengaliFontUrl from './pdf-assets/NotoSansBengali.ttf?url';

type Alignment = 'left' | 'right';
type Color = [number, number, number];
type TextStyle = { size: number; bold?: boolean; color?: Color };
type SavePdfPlugin = {
  save(options: { filename: string; base64: string }): Promise<{ saved: boolean }>;
};

const nativePdf = registerPlugin<SavePdfPlugin>('SmartShopPdf');
const margin = 37;
const ink: Color = [27, 39, 35];
const muted: Color = [77, 95, 88];
const green: Color = [21, 105, 77];
const line: Color = [218, 228, 223];
const white: Color = [255, 255, 255];
const text: TextStyle = { size: 9 };
const secondary: TextStyle = { size: 9, color: muted };
const smallHeading: TextStyle = { size: 10, bold: true, color: green };
const printableAscii = /^[\u0020-\u007e]*$/;
const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined;
let bengaliFont: Promise<void> | undefined;
let androidSaveOpen = false;

function prepareBengali(): Promise<void> | undefined {
  if (typeof FontFace !== 'function' || !document.fonts) return;
  bengaliFont ??= new FontFace('SmartShop Bengali', `url("${bengaliFontUrl}")`, { weight: '100 900' })
    .load().then(font => { document.fonts.add(font); }).catch(() => { /* Fall back to the device's Bengali font. */ });
  return bengaliFont;
}

async function loadLogo(url: string | null | undefined): Promise<HTMLImageElement | undefined> {
  if (!url) return undefined;
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(undefined), 4000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); resolve(undefined); };
    image.src = mediaUrl(url);
  });
}

function addLogo(pdf: jsPDF, image: HTMLImageElement | undefined, x: number, y: number) {
  const size = 42;
  if (image?.naturalWidth && image.naturalHeight) {
    try {
      const ratio = size / Math.max(image.naturalWidth, image.naturalHeight);
      const width = image.naturalWidth * ratio;
      const height = image.naturalHeight * ratio;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(width * 4);
      canvas.height = Math.ceil(height * 4);
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        pdf.addImage(canvas, 'PNG', x + (size - width) / 2, y + (size - height) / 2, width, height, 'shop-logo', 'FAST');
        return;
      }
    } catch { /* A missing or unreadable image uses the SmartShop mark. */ }
  }
  pdf.setFillColor(...green);
  pdf.roundedRect(x, y, size, size, 9, 9, 'F');
  pdf.setDrawColor(...white).setLineWidth(2);
  pdf.rect(x + 12, y + 16, 18, 16);
  pdf.lines([[0, -5], [2, -3], [6, 0], [2, 3], [0, 5]], x + 16, y + 16, [1, 1], 'S');
  pdf.lines([[3, 3], [5, -6]], x + 17, y + 24, [1, 1], 'S');
}

function normalized(value: string) {
  return String(value ?? '').replace(/[‐‑‒–—]/g, '-');
}

function cleanFileName(value: string) {
  const basename = value.replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 110);
  return `${basename || 'SmartShop-document'}.pdf`;
}

function createTextTools(pdf: jsPDF) {
  let canvas: HTMLCanvasElement | undefined;
  const context = () => {
    canvas ??= document.createElement('canvas');
    const drawing = canvas.getContext('2d');
    if (!drawing) throw new Error('This browser could not render the PDF text.');
    return drawing;
  };
  const font = (style: TextStyle) => `${style.bold ? 700 : 400} ${style.size}px "SmartShop Bengali", Arial, sans-serif`;
  const setFont = (style: TextStyle) => {
    pdf.setFont('helvetica', style.bold ? 'bold' : 'normal').setFontSize(style.size);
  };
  function measure(value: string, style: TextStyle) {
    if (printableAscii.test(value)) {
      setFont(style);
      return pdf.getTextWidth(value);
    }
    const drawing = context();
    drawing.font = font(style);
    return drawing.measureText(value).width;
  }
  function wrap(rawValue: string, width: number, style: TextStyle): string[] {
    const lines: string[] = [];
    for (const paragraph of normalized(rawValue).split(/\r?\n/)) {
      let current = '';
      for (const word of paragraph.trim().split(/\s+/)) {
        const candidate = current ? `${current} ${word}` : word;
        if (measure(candidate, style) <= width) {
          current = candidate;
          continue;
        }
        if (current) lines.push(current);
        current = '';
        if (measure(word, style) <= width) {
          current = word;
          continue;
        }
        const characters = graphemes ? Array.from(graphemes.segment(word), part => part.segment) : Array.from(word);
        for (const segment of characters) {
          if (current && measure(current + segment, style) > width) {
            lines.push(current);
            current = '';
          }
          current += segment;
        }
      }
      lines.push(current);
    }
    return lines;
  }
  function draw(value: string, x: number, y: number, style: TextStyle, align: Alignment = 'left') {
    if (!value) return;
    const color = style.color ?? ink;
    if (printableAscii.test(value)) {
      setFont(style);
      pdf.setTextColor(...color).text(value, x, y, { align });
      return;
    }

    // Canvas shapes complex scripts before jsPDF embeds the line.
    const drawing = context();
    drawing.font = font(style);
    const metrics = drawing.measureText(value);
    const ascent = Math.max(metrics.actualBoundingBoxAscent || 0, style.size);
    const descent = Math.max(metrics.actualBoundingBoxDescent || 0, style.size * 0.3);
    const scale = 3;
    const left = Math.max(metrics.actualBoundingBoxLeft || 0, 0) + 1;
    canvas!.width = Math.ceil((left + Math.max(metrics.width, metrics.actualBoundingBoxRight || 0) + 1) * scale);
    canvas!.height = Math.ceil((ascent + descent + 2) * scale);
    drawing.scale(scale, scale);
    drawing.font = font(style);
    drawing.textBaseline = 'alphabetic';
    drawing.fillStyle = `rgb(${color.join(',')})`;
    drawing.fillText(value, left, ascent + 1);
    const start = align === 'right' ? x - metrics.width : x;
    pdf.addImage(canvas!, 'PNG', start - left, y - ascent - 1, canvas!.width / scale, canvas!.height / scale, undefined, 'FAST');
  }
  return { wrap, draw };
}

function numericColumn(label: string) {
  return /^(qty|quantity|units|unit (cost|price)|paid\b.*|due|amount|bill|balance|total\b.*|received\b.*|still due|stock|line total|selling price|cost|price)$/i.test(label);
}

function columnWeight(label: string) {
  if (/product|item|description|supplier|reference|customer|title|note/i.test(label)) return 1.55;
  if (/^(qty|quantity|units|id|bill no\.?|type|method)$/i.test(label)) return 0.65;
  return 1;
}

export async function createShopPdf(doc: ShopDocument) {
  const usesBengali = /[\u0980-\u09ff]/.test(JSON.stringify(doc));
  const [logo] = await Promise.all([loadLogo(doc.shop.logoUrl), usesBengali ? prepareBengali() : undefined]);
  const wide = doc.sections.some(section => section.columns.length > 6);
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: wide ? 'landscape' : 'portrait', compress: true, putOnlyUsedFonts: true });
  pdf.setProperties({ title: doc.title, author: doc.shop.name, creator: 'SmartShop' });
  const { draw, wrap } = createTextTools(pdf);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;
  const bottom = pageHeight - 53;
  let y = margin;

  function drawParagraph(value: string, x: number, width: number, style: TextStyle, lineHeight: number) {
    for (const row of wrap(value, width, style)) {
      draw(row, x, y + style.size, style);
      y += lineHeight;
    }
  }

  function divider() {
    pdf.setDrawColor(...line).setLineWidth(0.6).line(margin, y, pageWidth - margin, y);
  }

  function nextPage() {
    pdf.addPage();
    y = margin;
    draw(wrap(doc.shop.name, contentWidth * 0.52, smallHeading)[0], margin, y + 10, smallHeading);
    draw(wrap(doc.title, contentWidth * 0.42, secondary)[0], pageWidth - margin, y + 10, secondary, 'right');
    y += 23;
    divider();
    y += 16;
  }

  function ensureSpace(height: number) {
    if (y + height > bottom) nextPage();
  }

  pdf.setFillColor(...green).rect(0, 0, pageWidth, 6, 'F');
  addLogo(pdf, logo, margin, y);
  const shopLeft = margin + 55;
  const shopWidth = contentWidth - 55 - (doc.status ? 96 : 0);
  drawParagraph(doc.shop.name, shopLeft, shopWidth, { size: 14, bold: true }, 18);
  const contact = [doc.shop.phone, doc.shop.email].filter(Boolean).join('  |  ');
  if (doc.shop.address) drawParagraph(doc.shop.address, shopLeft, shopWidth, secondary, 13);
  if (contact) drawParagraph(contact, shopLeft, shopWidth, secondary, 13);
  if (doc.status) {
    const color: Color = doc.status === 'PAID' ? [16, 117, 70] : [176, 45, 45];
    const x = pageWidth - margin - 77;
    pdf.setDrawColor(...color).setLineWidth(1.6).roundedRect(x, margin + 5, 77, 33, 4, 4, 'S');
    pdf.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...color);
    pdf.text(doc.status, x + 38.5, margin + 27, { align: 'center' });
  }
  y = Math.max(y, margin + 42) + 16;
  divider();
  y += 13;
  drawParagraph(doc.title, margin, contentWidth, { size: 23, bold: true }, 29);
  if (doc.subtitle) drawParagraph(doc.subtitle, margin, contentWidth, secondary, 14);
  y += 12;

  if (doc.details?.length) {
    const gap = 18;
    const fieldWidth = (contentWidth - gap) / 2;
    for (let i = 0; i < doc.details.length; i += 2) {
      const fields = doc.details.slice(i, i + 2).map(field => ({ ...field, lines: wrap(field.value, fieldWidth, text) }));
      const maxLines = Math.max(...fields.map(field => field.lines.length));
      const height = 16 + maxLines * 13;
      ensureSpace(height);
      fields.forEach((field, index) => {
        const left = margin + index * (fieldWidth + gap);
        draw(normalized(field.label), left, y + 9, smallHeading);
        field.lines.forEach((value, row) => draw(value, left, y + 24 + row * 13, text));
      });
      y += height + 6;
    }
    y += 10;
  }

  for (const section of doc.sections) {
    if (!section.columns.length) continue;
    const headings: TextStyle = { size: 8.7, bold: true, color: white };
    const weights = section.columns.map(columnWeight);
    const weightTotal = weights.reduce((total, weight) => total + weight, 0);
    const widths = weights.map(weight => contentWidth * weight / weightTotal);
    const alignments = section.columns.map<Alignment>(label => numericColumn(label) ? 'right' : 'left');
    const headers = section.columns.map((label, index) => wrap(label, widths[index] - 14, headings));
    const headerHeight = Math.max(...headers.map(lines => lines.length)) * 12 + 12;
    const rowLineHeight = 13;
    const rowPadding = 12;
    function drawCells(cells: string[][], top: number, style: TextStyle, lineHeight: number) {
      let x = margin;
      cells.forEach((lines, index) => {
        const align = alignments[index];
        const textX = align === 'right' ? x + widths[index] - 7 : x + 7;
        lines.forEach((value, row) => draw(value, textX, top + style.size + row * lineHeight, style, align));
        x += widths[index];
      });
    }
    function sectionHeader(continued = false) {
      const title = section.title ? `${section.title}${continued ? ' (continued)' : ''}` : '';
      if (title) {
        drawParagraph(title, margin, contentWidth, smallHeading, 15);
        y += 5;
      }
      pdf.setFillColor(...green).rect(margin, y, contentWidth, headerHeight, 'F');
      drawCells(headers, y + 6, headings, 12);
      y += headerHeight;
    }
    ensureSpace(headerHeight + 20 + rowLineHeight + rowPadding);
    sectionHeader();
    if (!section.rows.length) {
      pdf.setFillColor(244, 249, 246).rect(margin, y, contentWidth, 28, 'F');
      draw('No records for this selection.', margin + 7, y + 17, secondary);
      y += 28;
    }
    section.rows.forEach((row, index) => {
      const cells = section.columns.map((_, column) => wrap(row[column] ?? '', widths[column] - 14, text));
      const rowLines = Math.max(...cells.map(lines => lines.length));
      const rowHeight = rowLines * rowLineHeight + rowPadding;
      const newPageCapacity = bottom - margin - 39 - headerHeight - 20;
      if (rowHeight <= newPageCapacity && y + rowHeight > bottom) {
        nextPage();
        sectionHeader(true);
      }
      let offset = 0;
      while (offset < rowLines) {
        let count = Math.floor((bottom - y - rowPadding) / rowLineHeight);
        if (count < 1) {
          nextPage();
          sectionHeader(true);
          count = Math.floor((bottom - y - rowPadding) / rowLineHeight);
        }
        count = Math.min(count, rowLines - offset);
        const height = count * rowLineHeight + rowPadding;
        if (index % 2 === 0) pdf.setFillColor(244, 249, 246).rect(margin, y, contentWidth, height, 'F');
        drawCells(cells.map(lines => lines.slice(offset, offset + count)), y + 6, text, rowLineHeight);
        y += height;
        divider();
        offset += count;
      }
    });
    y += 18;
  }

  if (doc.totals?.length) {
    const totalsWidth = Math.min(contentWidth, 294);
    const totalsLeft = pageWidth - margin - totalsWidth;
    ensureSpace(Math.min(doc.totals.length, 5) * 27);
    doc.totals.forEach((total, index) => {
      const last = index === doc.totals!.length - 1;
      const style: TextStyle = { size: last ? 10.5 : 9.5, bold: last, color: last ? green : ink };
      const labels = wrap(total.label, totalsWidth * 0.55 - 14, style);
      const values = wrap(total.value, totalsWidth * 0.45 - 14, style);
      const height = Math.max(labels.length, values.length) * 14 + 11;
      ensureSpace(height);
      pdf.setFillColor(...(last ? [224, 244, 233] as Color : [244, 249, 246] as Color)).rect(totalsLeft, y, totalsWidth, height, 'F');
      labels.forEach((value, row) => draw(value, totalsLeft + 10, y + 15 + row * 14, style));
      values.forEach((value, row) => draw(value, pageWidth - margin - 10, y + 15 + row * 14, style, 'right'));
      y += height;
    });
    y += 10;
  }
  if (doc.note) {
    for (const value of wrap(doc.note, contentWidth, secondary)) {
      ensureSpace(14);
      draw(value, margin, y + 9, secondary);
      y += 14;
    }
  }

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    y = pageHeight - 38;
    divider();
    draw('SmartShop', margin, y + 15, secondary);
    draw(`Page ${page} of ${pages}`, pageWidth - margin, y + 15, secondary, 'right');
  }
  return pdf;
}

export async function downloadShopDocument(doc: ShopDocument): Promise<void> {
  const filename = cleanFileName(doc.filename);
  const pdf = await createShopPdf(doc);
  if (Capacitor.getPlatform() === 'android') {
    if (androidSaveOpen) throw new Error('Finish saving the open PDF first.');
    androidSaveOpen = true;
    try {
      const base64 = pdf.output('datauristring').split(',')[1];
      await nativePdf.save({ filename, base64 });
    } finally { androidSaveOpen = false; }
    return;
  }
  pdf.save(filename);
}
