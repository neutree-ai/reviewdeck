import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "rd:inline-flex rd:items-center rd:justify-center rd:gap-2 rd:text-sm rd:font-medium rd:whitespace-nowrap rd:transition-all rd:duration-150 focus-visible:rd:outline-none focus-visible:rd:ring-1 focus-visible:rd:ring-ring disabled:rd:pointer-events-none disabled:rd:opacity-50 rd:cursor-pointer active:rd:scale-[0.97]",
  {
    variants: {
      variant: {
        default:
          "rd:bg-primary rd:text-primary-foreground hover:rd:brightness-110 rd:rounded-md rd:shadow-[0_1px_2px_oklch(0/0/0/0.3)]",
        secondary:
          "rd:bg-secondary rd:text-secondary-foreground hover:rd:bg-secondary/80 rd:rounded-md",
        outline:
          "rd:border rd:border-border rd:bg-transparent rd:text-muted-foreground hover:rd:text-foreground hover:rd:border-foreground/20 hover:rd:bg-surface rd:rounded-md",
        ghost:
          "rd:text-muted-foreground hover:rd:text-foreground hover:rd:bg-surface rd:rounded-md",
        success:
          "rd:bg-success rd:text-success-foreground hover:rd:brightness-110 rd:rounded-md rd:shadow-[0_1px_2px_oklch(0/0/0/0.3)]",
        destructive:
          "rd:bg-destructive rd:text-destructive-foreground hover:rd:brightness-110 rd:rounded-md rd:shadow-[0_1px_2px_oklch(0/0/0/0.3)]",
      },
      size: {
        default: "rd:h-9 rd:px-4 rd:py-2",
        sm: "rd:h-7 rd:px-3 rd:text-xs",
        lg: "rd:h-10 rd:px-5 rd:text-sm",
        icon: "rd:h-8 rd:w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
