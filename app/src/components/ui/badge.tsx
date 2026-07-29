import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

const badgeVariants = cva("badge", {
  variants: {
    tone: {
      neutral: "badge-neutral",
      success: "badge-success",
      warning: "badge-warning",
      danger: "badge-danger"
    }
  },
  defaultVariants: {
    tone: "neutral"
  }
});

export function Badge({ className, tone, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
