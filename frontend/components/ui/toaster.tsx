"use client"

import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast"
import { useToast } from "@/components/ui/use-toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, action, position, ...props }) => {
        // Determine position classes based on the position prop
        let positionClasses = "bottom-0 right-0 flex flex-col gap-2 w-full sm:w-auto sm:max-w-[420px]"

        if (position === "top-right") {
          positionClasses = "top-0 right-0 flex flex-col gap-2 w-full sm:w-auto sm:max-w-[420px]"
        } else if (position === "top-center") {
          positionClasses = "top-0 left-1/2 -translate-x-1/2 flex flex-col gap-2 w-full sm:w-auto sm:max-w-[420px]"
        } else if (position === "bottom-center") {
          positionClasses = "bottom-0 left-1/2 -translate-x-1/2 flex flex-col gap-2 w-full sm:w-auto sm:max-w-[420px]"
        }

        return (
          <Toast key={id} {...props} className="bg-white text-black border border-gray-200 shadow-md">
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport className={`fixed p-6 z-[100] md:max-w-[420px] flex flex-col gap-2`} />
    </ToastProvider>
  )
}
