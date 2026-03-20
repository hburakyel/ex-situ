import { Spinner as RadixSpinner } from "@radix-ui/themes"

export function Spinner({ className, size }: { className?: string; size?: "1" | "2" | "3" }) {
  return (
    <span className={className}>
      <RadixSpinner size={size ?? "1"} />
    </span>
  )
}
