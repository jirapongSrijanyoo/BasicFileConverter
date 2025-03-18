const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const readline = require('readline');
const PDFDocument = require('pdfkit');
const pdfjs = require('pdfjs-dist/build/pdf');
const { createCanvas } = require('canvas');

// ตั้งค่า Global Worker Options
pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/build/pdf.worker.js');

// สร้าง interface สำหรับรับ input จาก terminal
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// ฟังก์ชันสร้างชื่อไฟล์จากวันที่และเวลา
function generateTimestampFilename(extension) {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0'); 
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${day}-${month}-${year}_${hours}-${minutes}-${seconds}.${extension}`;
}

async function askOutputFormat() {
    return new Promise((resolve) => {
        rl.question(
            'เลือกฟอร์แมตปลายทาง (webp, jpeg, png, pdf) หรือพิมพ์ฟอร์แมตที่ต้องการ: ',
            (answer) => {
                const format = answer.toLowerCase().trim();
                const supportedFormats = ['webp', 'jpeg', 'jpg', 'png', 'pdf'];
                if (supportedFormats.includes(format)) {
                    resolve(format);
                } else {
                    console.log('ฟอร์แมตไม่รองรับ! ใช้ webp เป็นค่าเริ่มต้น');
                    resolve('webp');
                }
            }
        );
    });
}

async function askCombinePdf() {
    return new Promise((resolve) => {
        rl.question(
            'ต้องการรวมทุกภาพใน PDF ไฟล์เดียวหรือไม่? (y/n): ',
            (answer) => {
                resolve(answer.toLowerCase().trim() === 'y');
                rl.close();
            }
        );
    });
}

// ฟังก์ชันแปลงรูปเป็น PDF (แบบแยกไฟล์)
async function imageToPdfSeparate(inputPath, outputPath) {
    const doc = new PDFDocument({ autoFirstPage: false });
    const pdfStream = require('fs').createWriteStream(outputPath);
    doc.pipe(pdfStream);

    const img = await sharp(inputPath, { limitInputPixels: false }).png().toBuffer();
    const { width, height } = await sharp(inputPath).metadata();
    
    doc.addPage({ size: [width, height] });
    doc.image(img, 0, 0, { width, height });
    doc.end();

    return new Promise((resolve, reject) => {
        pdfStream.on('finish', resolve);
        pdfStream.on('error', reject);
    });
}

// ฟังก์ชันแปลงรูปเป็น PDF (แบบรวมไฟล์)
async function imagesToPdfCombined(inputFiles, inputFolder, outputPath) {
    const doc = new PDFDocument({ autoFirstPage: false });
    const pdfStream = require('fs').createWriteStream(outputPath);
    doc.pipe(pdfStream);

    for (const file of inputFiles) {
        const inputPath = path.join(inputFolder, file);
        const ext = path.extname(file).toLowerCase();
        if (['.png', '.jpeg', '.jpg', '.webp'].includes(ext)) {
            const img = await sharp(inputPath, { limitInputPixels: false }).png().toBuffer();
            const { width, height } = await sharp(inputPath).metadata();
            
            doc.addPage({ size: [width, height] });
            doc.image(img, 0, 0, { width, height });
        }
    }
    doc.end();

    return new Promise((resolve, reject) => {
        pdfStream.on('finish', resolve);
        pdfStream.on('error', reject);
    });
}

// ฟังก์ชันแปลง PDF เป็นรูป
async function pdfToImage(inputPath, outputPathBase) {
    const data = new Uint8Array(await fs.readFile(inputPath));
    const pdf = await pdfjs.getDocument({ data }).promise;
    
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');

        await page.render({ canvasContext: context, viewport }).promise;
        
        const outputFile = `${outputPathBase.replace('.png', '')}-${i}.png`;
        await fs.writeFile(outputFile, canvas.toBuffer('image/png'));
    }
}

async function convertImages(inputFolder, outputFolder) {
    try {
        // รับฟอร์แมตปลายทางจากผู้ใช้
        let outputFormat = await askOutputFormat();
        let combinePdf = false;
        if (outputFormat === 'pdf') {
            combinePdf = await askCombinePdf();
        } else {
            rl.close();
        }
        
        // สร้างโฟลเดอร์ปลายทางถ้ายังไม่มี
        await fs.mkdir(outputFolder, { recursive: true });
        
        // อ่านรายการไฟล์ทั้งหมดในโฟลเดอร์ต้นทาง
        const files = await fs.readdir(inputFolder);
        
        // กรองไฟล์ภาพและ PDF ที่รองรับ
        const inputFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.png', '.jpeg', '.jpg', '.webp', '.pdf'].includes(ext);
        });
        
        // ปรับการตั้งค่า sharp
        sharp.cache({ memory: 12000 });
        sharp.concurrency(4);
        
        // กรณีรวม PDF เป็นไฟล์เดียว
        if (outputFormat === 'pdf' && combinePdf) {
            const outputPath = path.join(outputFolder, generateTimestampFilename('pdf'));
            console.log(`กำลังแปลงทุกภาพเป็น: ${outputPath}`);
            await imagesToPdfCombined(inputFiles, inputFolder, outputPath);
            console.log(`เสร็จสิ้น: ${outputPath}`);
            console.log('แปลงไฟล์ทั้งหมดเสร็จเรียบร้อย!');
            return;
        }

        // วนลูปแปลงไฟล์แต่ละไฟล์
        for (const file of inputFiles) {
            const inputPath = path.join(inputFolder, file);
            const ext = path.extname(file).toLowerCase();
            const outputFileName = generateTimestampFilename(outputFormat === 'pdf' ? 'pdf' : outputFormat);
            const outputPath = path.join(outputFolder, outputFileName);
            
            console.log(`กำลังแปลง: ${file} -> ${outputFileName}`);
            
            if (ext === '.pdf' && outputFormat !== 'pdf') {
                await pdfToImage(inputPath, outputPath);
                console.log(`เสร็จสิ้น: ${outputFileName}`);
                continue;
            } else if (outputFormat === 'pdf') {
                await imageToPdfSeparate(inputPath, outputPath);
                console.log(`เสร็จสิ้น: ${outputFileName}`);
                continue;
            }

            // การแปลงระหว่างรูปภาพ
            const sharpInstance = sharp(inputPath, { 
                limitInputPixels: false,
                sequentialRead: true
            });

            if (outputFormat === 'webp') {
                sharpInstance.resize({
                    width: 16383,
                    height: 16383,
                    fit: 'inside',
                    withoutEnlargement: true
                });
            }

            switch (outputFormat) {
                case 'webp':
                    sharpInstance.webp({ 
                        quality: 80,
                        effort: 6,
                        lossless: false,
                        smartSubsample: true
                    });
                    break;
                case 'jpeg':
                case 'jpg':
                    sharpInstance.jpeg({ 
                        quality: 80,
                        progressive: true
                    });
                    break;
                case 'png':
                    sharpInstance.png({ 
                        compressionLevel: 9,
                        progressive: true
                    });
                    break;
            }
            
            await sharpInstance.toFile(outputPath);
            console.log(`เสร็จสิ้น: ${outputFileName}`);
        }
        
        console.log('แปลงไฟล์ทั้งหมดเสร็จเรียบร้อย!');
        
    } catch (error) {
        console.error('เกิดข้อผิดพลาด:', error);
    }
}

// ตัวอย่างการใช้งาน
const inputFolder = './input';
const outputFolder = './output';

convertImages(inputFolder, outputFolder);