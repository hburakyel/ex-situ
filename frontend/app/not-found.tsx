export default function NotFound() {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-white text-black">
      <p className="text-sm">Page not found.</p>
      <a href="/" className="text-sm underline">
        Home
      </a>
    </div>
  )
}
