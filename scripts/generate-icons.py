"""Draw the app's target as launcher icons. Run with Python and Pillow."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "images"
SIZE = 1024
SCALE = 3
BACKGROUND = "#101C20"


def target(radius, background, monochrome=False):
    # Draw large first so the small icon edges stay smooth.
    image = Image.new("RGBA", (SIZE * SCALE, SIZE * SCALE), background)
    draw = ImageDraw.Draw(image)
    center = SIZE * SCALE / 2
    stroke = round(3 * SCALE)
    for index in range(10):
        ring = radius * (10 - index) / 10 * SCALE
        bounds = (center - ring, center - ring, center + ring, center + ring)
        if monochrome:
            draw.ellipse(bounds, outline="white", width=stroke)
            if index == 9:
                draw.ellipse(bounds, fill="white")
        else:
            fill = "#EEECE3" if index < 4 else "#EFB96A" if index == 9 else "#24373B"
            edge = "#83918A" if index < 4 else "#A0AAA4"
            draw.ellipse(bounds, fill=fill, outline=edge, width=stroke)

    half_cross = radius * 0.15 * SCALE
    ink = "white" if monochrome else "#3C443C"
    draw.line((center - half_cross, center, center + half_cross, center), fill=ink, width=stroke)
    draw.line((center, center - half_cross, center, center + half_cross), fill=ink, width=stroke)

    if not monochrome:
        font_path = Path("C:/Windows/Fonts/seguisb.ttf")
        font_size = round(radius * 2 * 10 / 276 * SCALE)
        font = ImageFont.truetype(str(font_path), font_size) if font_path.exists() else ImageFont.load_default(size=font_size)
        for score in (2, 4, 6, 8):
            y = center - radius * SCALE + radius * SCALE * (score - 0.5) / 10
            draw.text((center, y), str(score), font=font, anchor="mm",
                fill="#4B5D59" if score <= 4 else "#CFD5CF")
    return image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def main():
    target(420, BACKGROUND).convert("RGB").save(ASSETS / "icon.png")
    # Leave room for Android's circle and rounded-square icon masks.
    target(310, (0, 0, 0, 0)).save(ASSETS / "android-icon-foreground.png")
    target(310, (0, 0, 0, 0), monochrome=True).save(ASSETS / "android-icon-monochrome.png")
    Image.new("RGB", (SIZE, SIZE), BACKGROUND).save(ASSETS / "android-icon-background.png")
    target(420, BACKGROUND).resize((64, 64), Image.Resampling.LANCZOS).save(ASSETS / "favicon.png")
    print("Target icons saved in assets/images")


if __name__ == "__main__":
    main()
