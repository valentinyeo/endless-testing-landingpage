# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a single-page landing page for EndlessTesting.ai, an AI-powered A/B testing platform. The entire site is contained in a single `index.html` file with inline CSS and JavaScript.

## Architecture

**Single-File Structure**: The project uses a monolithic HTML file approach with:
- Embedded CSS (lines 11-145) using CSS custom properties for theming
- Inline JavaScript (lines 411-439) for smooth scrolling, performance monitoring, and animated comparison table
- No build process or dependencies required
- Google Fonts loaded for typography (Inter, Playfair Display, Merriweather, Libre Baskerville)

**Design System**: CSS custom properties defined in `:root` (line 13) establish the color palette:
- Primary colors: `--primary`/`--bittersweet` (#FF595E), `--dark-green` (#053225), `--accent`/`--mindaro` (#C5D86D)
- Secondary: `--secondary`/`--uranian-blue` (#A5D8FF), `--licorice` (#1F0812)
- Typography: Playfair Display/Merriweather (serif headings) + Inter (body text)
- Responsive breakpoints: 768px (mobile), 480px (small mobile)

**Key Sections** (in order):
1. Navigation (lines 148-165) - Sticky nav with logo and icon
2. Hero (lines 167-227) - Gradient background with before/after comparison images and animated comparison table
3. Social Proof (lines 229-240) - Company logos placeholder
4. Key Features (lines 242-263) - 3-column feature grid with links
5. How It Works (lines 265-286) - 3-step numbered process
6. Use Cases (lines 288-306) - Application examples with hover effects
7. Testimonials (lines 308-326) - Customer quotes in card layout
8. Final CTA (lines 328-333) - Dark green call-to-action section
9. Pricing (lines 336-383) - 3-tier pricing cards with featured badge
10. Footer (lines 385-409) - Multi-column footer with links

## Images

Images are stored in `/images/`:
- `icon.png` - Logo icon used in navigation
- `guy.png` - "Before" hero image (frustrated marketer)
- `girl.png` - "After" hero image (celebrating marketer)
- `jp.jpg` - Testimonial avatar (JP Bisson)
- Additional unused images: `guy-office.png`, `guy2.png`, `woman-desk.png`, `woman2.png`, `image.png`, `liam-mcpartland.png`

## Development

**No Build Required**: Open `index.html` directly in a browser or use a simple HTTP server:
```bash
# Python
python -m http.server 8000

# Node.js (if http-server is installed)
npx http-server

# PHP
php -S localhost:8000
```

**Editing**: All changes are made directly to `index.html`:
- CSS: Lines 11-145 (within `<style>` tags)
- Content: Lines 147-409 (HTML body)
- JavaScript: Lines 411-439 (within `<script>` tags)

**Responsive Design**: Media queries at 768px and 480px handle mobile layouts:
- Hero images stack vertically on mobile (line 124)
- Navigation links hidden on mobile (line 126)
- Grid layouts collapse to single column (line 127)

**Interactive Features**:
- Smooth scroll navigation to section anchors
- Animated comparison table that reveals rows sequentially (lines 429-438, interval of 1500ms)
- Hover effects on cards, testimonials, and navigation links
- Performance monitoring logs page load time to console

## Notes

- Not a git repository (no version control configured)
- No package.json or build tooling
- No external CSS/JS files - everything is self-contained
- Performance monitoring logs page load time to console (lines 407-410)
