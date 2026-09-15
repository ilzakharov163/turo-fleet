import Image from 'next/image'

export default function Logo({ size = 40 }: { size?: number; showText?: boolean }) {
  return (
    <Image
      src="/logo.png"
      alt="Turo Fleet"
      width={size}
      height={size}
      style={{ objectFit: 'contain', width: size, height: size }}
      unoptimized
      priority
    />
  )
}
