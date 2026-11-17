// Генерирует PNG-иконки расширения из assets/icon.svg в public/icon/.
// Запуск: npm run icons (нужен только после изменения icon.svg).
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const sizes = [16, 32, 48, 128];

await mkdir('public/icon', { recursive: true });
for (const size of sizes) {
  await sharp('assets/icon.svg', { density: 384 }).resize(size, size).png().toFile(`public/icon/${size}.png`);
  console.log(`public/icon/${size}.png`);
}
