import { cn } from "@/lib/utils"

const LEAVES = [0, 1, 2, 3, 4, 5, 6, 7]

type SpinnerSize = "1" | "2" | "3"

/** The spinner itself, a block element; styles in app/globals.css. */
export function SpinnerMark({ className, size = "1" }: { className?: string; size?: SpinnerSize }) {
  return (
    <span className={cn("spinner", `spinner-${size}`, className)}>
      {LEAVES.map((leaf) => (
        <span key={leaf} className="spinner-leaf" />
      ))}
    </span>
  )
}

export function Spinner({ className, size }: { className?: string; size?: SpinnerSize }) {
  return (
    <span className={className}>
      <SpinnerMark size={size} />
    </span>
  )
}
