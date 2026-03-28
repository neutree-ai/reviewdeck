import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "rd:inline-flex rd:items-center rd:justify-center rd:rounded-full rd:font-medium rd:font-[family-name:var(--font-mono)] rd:tabular-nums rd:transition-colors",
  {
    variants: {
      variant: {
        default: "rd:bg-primary-muted rd:text-primary",
        secondary: "rd:bg-muted/60 rd:text-muted-foreground",
        success: "rd:bg-success/12 rd:text-success",
        destructive: "rd:bg-destructive/12 rd:text-destructive",
      },
      size: {
        default: "rd:px-2 rd:py-0.5 rd:text-[11px]",
        sm: "rd:min-w-[18px] rd:h-[18px] rd:px-1 rd:text-[10px]",
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
