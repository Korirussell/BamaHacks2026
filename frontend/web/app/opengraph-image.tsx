import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const alt = 'Handoff';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  const webp = await readFile(join(process.cwd(), 'public/brand/icon-1024.webp'));
  const png = await sharp(webp).png().toBuffer();
  const iconSrc = `data:image/png;base64,${png.toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FDF4EC',
        }}
      >
        <img src={iconSrc} width={420} height={420} alt="" />
      </div>
    ),
    { ...size },
  );
}
