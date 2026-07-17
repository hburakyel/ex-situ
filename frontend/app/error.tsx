"use client"

export default function Error({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-white text-black">
      <p className="text-sm">Something went wrong — try refreshing.</p>
      <div className="flex gap-4 text-sm underline">
        <button onClick={() => reset()}>Refresh</button>
        <a href="/">Home</a>
      </div>
    </div>
  )
}
