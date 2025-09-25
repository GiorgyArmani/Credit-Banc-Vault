import { renderToBuffer } from '@react-pdf/renderer';
import HtmlToPDF from '@/components/pdf/html-to-pdf';

export async function generatePDFBuffer(html: string) {
  // Invoca el componente y pásale las props directamente
  const doc = HtmlToPDF({ html });
  return await renderToBuffer(doc);
}
