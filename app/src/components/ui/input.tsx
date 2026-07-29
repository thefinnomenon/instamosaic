import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

export function Input({ className, type, ...props }: ComponentProps<"input">) {
  return <input type={type} className={cn("field", className)} {...props} />;
}
