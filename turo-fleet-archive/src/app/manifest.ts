import type { MetadataRoute } from 'next'

// Приложение на экране «Домой» (iPhone: Safari → Поделиться → На экран «Домой»)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Fleet Manager — Turo',
    short_name: 'Fleet',
    description: 'Управление автопарком Turo',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
