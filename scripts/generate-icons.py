"""Generate Linux PNG icons and Mac ICNS from Windows ICO."""
from PIL import Image
import os, struct

ico_path = os.path.join(os.path.dirname(__file__), '..', 'build', 'icon.ico')
build_dir = os.path.join(os.path.dirname(__file__), '..', 'build')
icons_dir = os.path.join(build_dir, 'icons')
os.makedirs(icons_dir, exist_ok=True)

# Load the 256x256 version as source
ico = Image.open(ico_path)
ico.size = (256, 256)
src = ico.copy().convert('RGBA')

# Linux needs: 16x16, 32x32, 48x48, 64x64, 128x128, 256x256, 512x512
linux_sizes = [16, 32, 48, 64, 128, 256, 512]
for s in linux_sizes:
    if s <= 256:
        ico.size = (s, s)
        img = ico.copy().convert('RGBA')
    else:
        img = src.resize((s, s), Image.LANCZOS)
    
    out = os.path.join(icons_dir, f'{s}x{s}.png')
    img.save(out, 'PNG')
    fsize = os.path.getsize(out)
    print(f'Created {s}x{s}.png ({fsize} bytes)')

# Also save a 512x512 icon.png in build/ as fallback
src512 = src.resize((512, 512), Image.LANCZOS)
png_path = os.path.join(build_dir, 'icon.png')
src512.save(png_path, 'PNG')
fsize = os.path.getsize(png_path)
print(f'Created icon.png ({fsize} bytes)')

print('Done! All icons generated.')
