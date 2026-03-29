import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full font-medium font-[family-name:var(--font-mono)] tabular-nums transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary-muted text-primary",
        secondary: "bg-muted/60 text-muted-foreground",
        success: "bg-success/12 text-success",
        destructive: "bg-destructive/12 text-destructive",
      },
      size: {
        default: "px-2 py-0.5 text-[11px]",
        sm: "min-w-[18px] h-[18px] px-1 text-[10px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size, className }))} {...props} />;
}

export { Badge, badgeVariants };
