"use client";
import { useTheme } from "@/lib/ThemeContext"
import { Toaster as Sonner } from "sonner"

const Toaster = ({
  ...props
}) => {
  // Was reading next-themes' useTheme(), a package this app never actually
  // wires up a provider for -- it always returned the hardcoded "system"
  // default, so toasts followed the OS's color-scheme preference instead
  // of the app's own explicit dark-mode toggle (ThemeContext.jsx), visibly
  // mismatching the rest of the UI whenever a user's in-app choice differs
  // from their OS setting.
  const { isDark } = useTheme()
  const theme = isDark ? "dark" : "light"

  return (
    (<Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props} />)
  );
}

export { Toaster }
