"use client"

import * as React from "react"

import type { ToastActionElement, ToastProps as ToastActionProps } from "@/components/ui/toast"

const TOAST_LIMIT = 5
const TOAST_REMOVE_DELAY = 5000

type ToasterToast = ToastActionProps & {
	id: string
	title?: React.ReactNode
	description?: React.ReactNode
	action?: ToastActionElement
	position?: "top-right" | "top-center" | "bottom-right" | "bottom-center"
}

const actionTypes = {
	ADD_TOAST: "ADD_TOAST",
	UPDATE_TOAST: "UPDATE_TOAST",
	DISMISS_TOAST: "DISMISS_TOAST",
	REMOVE_TOAST: "REMOVE_TOAST",
} as const

let count = 0

function genId() {
	count = (count + 1) % Number.MAX_SAFE_INTEGER
	return count.toString()
}

type ActionType = typeof actionTypes

type Action =
	| {
			type: ActionType["ADD_TOAST"]
			toast: ToasterToast
		}
	| {
			type: ActionType["UPDATE_TOAST"]
			toast: Partial<ToasterToast>
		}
	| {
			type: ActionType["DISMISS_TOAST"]
			toastId?: string
		}
	| {
			type: ActionType["REMOVE_TOAST"]
			toastId?: string
		}

interface State {
	toasts: ToasterToast[]
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

const reducer = (state: State, action: Action): State => {
	switch (action.type) {
		case actionTypes.ADD_TOAST:
			return {
				...state,
				toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
			}

		case actionTypes.UPDATE_TOAST:
			return {
				...state,
				toasts: state.toasts.map((toast) =>
					toast.id === action.toast.id ? { ...toast, ...action.toast } : toast,
				),
			}

		case actionTypes.DISMISS_TOAST: {
			const { toastId } = action

			if (toastId) {
				toastTimeouts.set(
					toastId,
					setTimeout(() => {
						toastTimeouts.delete(toastId)
						dispatch({
							type: actionTypes.REMOVE_TOAST,
							toastId,
						})
					}, TOAST_REMOVE_DELAY),
				)
			}

			return {
				...state,
				toasts: state.toasts.map((toast) =>
					toast.id === toastId || toastId === undefined
						? {
								...toast,
								open: false,
							}
						: toast,
				),
			}
		}

		case actionTypes.REMOVE_TOAST:
			if (action.toastId === undefined) {
				return {
					...state,
					toasts: [],
				}
			}

			return {
				...state,
				toasts: state.toasts.filter((toast) => toast.id !== action.toastId),
			}
	}
}

const listeners: Array<(state: State) => void> = []

let memoryState: State = { toasts: [] }

function dispatch(action: Action) {
	memoryState = reducer(memoryState, action)
	listeners.forEach((listener) => {
		listener(memoryState)
	})
}

function toast({ title, description, action, variant, position = "bottom-right", ...props }: Omit<ToasterToast, "id">) {
	const id = genId()

	const update = (nextProps: ToastActionProps) =>
		dispatch({
			type: actionTypes.UPDATE_TOAST,
			toast: { ...nextProps, id },
		})

	const dismiss = () => dispatch({ type: actionTypes.DISMISS_TOAST, toastId: id })

	dispatch({
		type: actionTypes.ADD_TOAST,
		toast: {
			id,
			title,
			description,
			action,
			variant,
			position,
			...props,
		},
	})

	return {
		id,
		dismiss,
		update,
	}
}

function useToast() {
	const [state, setState] = React.useState<State>(memoryState)

	React.useEffect(() => {
		listeners.push(setState)

		return () => {
			const index = listeners.indexOf(setState)
			if (index > -1) {
				listeners.splice(index, 1)
			}
		}
	}, [])

	return {
		...state,
		toast,
		dismiss: (toastId?: string) => dispatch({ type: actionTypes.DISMISS_TOAST, toastId }),
	}
}

export { useToast, toast }
