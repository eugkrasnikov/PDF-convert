import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

async function createPDF() {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    
    const [regularFont, boldFont, italicFont] = await Promise.all([
        fetch('../fonts/arial.ttf').then(res => res.arrayBuffer()),
        fetch('../fonts/arialbd.ttf').then(res => res.arrayBuffer()),
        fetch('../fonts/ariali.ttf').then(res => res.arrayBuffer())
    ]);
    const customFont = await pdfDoc.embedFont(regularFont);
    
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 размер
    
    let currentY = 800;
    const margin = 50;
    const lineHeight = 20;
    const pageWidth = page.getWidth();
    const maxWidth = pageWidth - 2 * margin;
    
    async function embedSVGImage(imgElement: HTMLImageElement): Promise<[number, number]> {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        const computedStyle = window.getComputedStyle(imgElement);
        const displayWidth = parseFloat(computedStyle.width);
        const displayHeight = parseFloat(computedStyle.height);
        
        const width = displayWidth || imgElement.naturalWidth;
        const height = displayHeight || imgElement.naturalHeight;
        
        return new Promise((resolve) => {
            img.onload = async () => {
                canvas.width = width;
                canvas.height = height;
                ctx?.drawImage(img, 0, 0, width, height);
                
                const pngDataUrl = canvas.toDataURL('image/png');
                const pngImageBytes = await fetch(pngDataUrl).then(res => res.arrayBuffer());
                const pngImage = await pdfDoc.embedPng(pngImageBytes);
                
                resolve([width, height]);
            };
            img.src = imgElement.src;
        });
    }
    
    function getLines(text: string, fontSize: number): string[] {
        const words = text.split(' ');
        const lines: string[] = [];
        let currentLine = words[0];
        
        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = customFont.widthOfTextAtSize(`${currentLine} ${word}`, fontSize);
            
            if (width < maxWidth) {
                currentLine = `${currentLine} ${word}`;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        
        lines.push(currentLine);
        return lines;
    }
    
    async function processTextNode(node: Node, x: number, align: string, parentElement: Element) {
        let text = node.textContent?.trim() || '';
        if (!text) return;
        
        text = Array.from(text).map(char => char.normalize('NFC')).join('');
        
        const style = window.getComputedStyle(parentElement);
        const fontSize = 14;
        
        // Разбиваем текст на строки
        const lines = getLines(text, fontSize);
        
        for (const line of lines) {
            const textWidth = customFont.widthOfTextAtSize(line, fontSize);
            let xPos = x;
            
            switch (align) {
                case 'center':
                    xPos = (pageWidth - textWidth) / 2;
                    break;
                case 'right':
                    xPos = pageWidth - margin - textWidth;
                    break;
                case 'justify':
                    if (lines.indexOf(line) === lines.length - 1) {
                        // Последняя строка выравнивается по левому краю
                        xPos = margin;
                    } else {
                        // Распределяем пробелы равномерно
                        const words = line.split(' ');
                        const spaceWidth = (maxWidth - customFont.widthOfTextAtSize(line.replace(/ /g, ''), fontSize)) / (words.length - 1);
                        xPos = margin;
                        
                        for (let i = 0; i < words.length; i++) {
                            const word = words[i];
                            try {
                                page.drawText(word, {
                                    x: xPos,
                                    y: currentY,
                                    size: fontSize,
                                    font: customFont,
                                    color: rgb(0, 0, 0)
                                });
                            } catch (error) {
                                console.error('Error drawing word:', word, error);
                            }
                            xPos += customFont.widthOfTextAtSize(word, fontSize) + spaceWidth;
                        }
                        currentY -= lineHeight;
                        continue;
                    }
                    break;
            }
            
            try {
                page.drawText(line, {
                    x: xPos,
                    y: currentY,
                    size: fontSize,
                    font: customFont,
                    color: rgb(0, 0, 0)
                });
            } catch (error) {
                console.error('Error drawing line:', line, error);
            }
            
            currentY -= lineHeight;
        }
    }
    
    async function processElement(element: Element) {
        const style = window.getComputedStyle(element);
        const textAlign = style.textAlign;
        
        // Особая обработка для заголовка
        if (element.tagName === 'H1') {
            const text = element.textContent?.trim() || '';
            const fontSize = 24; // Размер шрифта для заголовка
            const textWidth = customFont.widthOfTextAtSize(text, fontSize);
            const xPos = (pageWidth - textWidth) / 2;
            
            page.drawText(text, {
                x: xPos,
                y: currentY,
                size: fontSize,
                font: customFont,
                color: rgb(0, 0, 0)
            });
            
            currentY -= lineHeight * 2;
            return;
        }
        
        if (element.tagName === 'IMG') {
            const imgElement = element as HTMLImageElement;
            if (imgElement.src.toLowerCase().endsWith('.svg')) {
                const [width, height] = await embedSVGImage(imgElement);
                const xPos = (pageWidth - width) / 2;
                
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const img = new Image();
                
                await new Promise((resolve) => {
                    img.onload = () => {
                        canvas.width = width;
                        canvas.height = height;
                        ctx?.drawImage(img, 0, 0, width, height);
                        resolve(null);
                    };
                    img.src = imgElement.src;
                });
                
                const pngDataUrl = canvas.toDataURL('image/png');
                const pngImageBytes = await fetch(pngDataUrl).then(res => res.arrayBuffer());
                const pngImage = await pdfDoc.embedPng(pngImageBytes);
                
                page.drawImage(pngImage, {
                    x: xPos,
                    y: currentY - height,
                    width,
                    height
                });
                
                currentY -= (height + lineHeight);
                return;
            }
        }
        
        for (const node of Array.from(element.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
                await processTextNode(node, margin, textAlign, element);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                await processElement(node as Element);
            }
        }
    }
    
    const content = document.querySelector('#content');
    if (content) {
        await processElement(content);
    }
    
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
}

document.addEventListener('DOMContentLoaded', () => {
    const pdfButton = document.getElementById('pdfButtonDesktop');
    if (pdfButton) {
        pdfButton.addEventListener('click', createPDF);
    }
});
