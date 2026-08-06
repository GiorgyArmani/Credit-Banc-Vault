"use client";

// Branded multi-step "conversation" stepper. Adapted from the React Bits
// Stepper (JS/CSS variant) but rewritten with Tailwind + our cb-* brand tokens
// instead of the original hardcoded purple + Stepper.css. Animations via
// framer-motion (installed) — the React Bits source imports from 'motion/react',
// which is the same API surface.
//
// Extras beyond React Bits:
//  - forwardRef exposes { next, back, goTo } so step content (e.g. a choice
//    that should auto-advance on click) can drive the stepper imperatively.
//  - completeButtonText for the final step's label.

import React, {
  useState,
  Children,
  useRef,
  useLayoutEffect,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

const MINT = "#55cf9e";

export interface StepperHandle {
  next: () => void;
  back: () => void;
  goTo: (step: number) => void;
}

interface StepperProps {
  children: ReactNode;
  initialStep?: number;
  onStepChange?: (step: number) => void;
  onFinalStepCompleted?: () => void;
  stepCircleContainerClassName?: string;
  stepContainerClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
  backButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  nextButtonProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
  backButtonText?: string;
  nextButtonText?: string;
  completeButtonText?: string;
  disableStepIndicators?: boolean;
  renderStepIndicator?: (props: {
    step: number;
    currentStep: number;
    onStepClick: (clicked: number) => void;
  }) => ReactNode;
}

const Stepper = forwardRef<StepperHandle, StepperProps>(function Stepper(
  {
    children,
    initialStep = 1,
    onStepChange = () => {},
    onFinalStepCompleted = () => {},
    stepCircleContainerClassName = "",
    stepContainerClassName = "",
    contentClassName = "",
    footerClassName = "",
    backButtonProps = {},
    nextButtonProps = {},
    backButtonText = "Back",
    nextButtonText = "Continue",
    completeButtonText = "Complete",
    disableStepIndicators = false,
    renderStepIndicator,
  },
  ref,
) {
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [direction, setDirection] = useState(0);
  const stepsArray = Children.toArray(children);
  const totalSteps = stepsArray.length;
  const isCompleted = currentStep > totalSteps;
  const isLastStep = currentStep === totalSteps;

  const updateStep = (newStep: number) => {
    setCurrentStep(newStep);
    if (newStep > totalSteps) onFinalStepCompleted();
    else onStepChange(newStep);
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setDirection(-1);
      updateStep(currentStep - 1);
    }
  };

  const handleNext = () => {
    if (!isLastStep) {
      setDirection(1);
      updateStep(currentStep + 1);
    }
  };

  const handleComplete = () => {
    setDirection(1);
    updateStep(totalSteps + 1);
  };

  useImperativeHandle(ref, () => ({
    next: () => (isLastStep ? handleComplete() : handleNext()),
    back: handleBack,
    goTo: (step: number) => {
      if (step === currentStep) return;
      setDirection(step > currentStep ? 1 : -1);
      updateStep(step);
    },
  }));

  return (
    <div
      className={cn(
        "w-full rounded-3xl bg-white shadow-xl border border-black/5",
        stepCircleContainerClassName,
      )}
    >
      {/* indicator row */}
      <div className={cn("flex w-full items-center px-6 pt-6 md:px-8 md:pt-7", stepContainerClassName)}>
        {stepsArray.map((_, index) => {
          const stepNumber = index + 1;
          const isNotLastStep = index < totalSteps - 1;
          return (
            <React.Fragment key={stepNumber}>
              {renderStepIndicator ? (
                renderStepIndicator({
                  step: stepNumber,
                  currentStep,
                  onStepClick: (clicked) => {
                    setDirection(clicked > currentStep ? 1 : -1);
                    updateStep(clicked);
                  },
                })
              ) : (
                <StepIndicator
                  step={stepNumber}
                  disableStepIndicators={disableStepIndicators}
                  currentStep={currentStep}
                  onClickStep={(clicked) => {
                    setDirection(clicked > currentStep ? 1 : -1);
                    updateStep(clicked);
                  }}
                />
              )}
              {isNotLastStep && <StepConnector isComplete={currentStep > stepNumber} />}
            </React.Fragment>
          );
        })}
      </div>

      <StepContentWrapper
        isCompleted={isCompleted}
        currentStep={currentStep}
        direction={direction}
        className={cn(contentClassName)}
      >
        {stepsArray[currentStep - 1]}
      </StepContentWrapper>

      {!isCompleted && (
        <div className={cn("px-6 pb-6 md:px-8 md:pb-7", footerClassName)}>
          <div className={cn("mt-4 flex items-center", currentStep !== 1 ? "justify-between" : "justify-end")}>
            {currentStep !== 1 && (
              <button
                type="button"
                onClick={handleBack}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-cb-gray transition-colors hover:text-cb-ink"
                {...backButtonProps}
              >
                {backButtonText}
              </button>
            )}
            <button
              type="button"
              onClick={isLastStep ? handleComplete : handleNext}
              className="flex items-center justify-center rounded-full bg-cb-mint px-6 py-3 text-sm font-bold tracking-tight text-cb-navy shadow-lg shadow-cb-mint/25 transition-all hover:bg-cb-mint/90 hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-40"
              {...nextButtonProps}
            >
              {isLastStep ? completeButtonText : nextButtonText}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default Stepper;

function StepContentWrapper({
  isCompleted,
  currentStep,
  direction,
  children,
  className,
}: {
  isCompleted: boolean;
  currentStep: number;
  direction: number;
  children: ReactNode;
  className?: string;
}) {
  const [parentHeight, setParentHeight] = useState(0);

  return (
    <motion.div
      className={cn("relative overflow-hidden", className)}
      style={{ position: "relative", overflow: "hidden" }}
      animate={{ height: isCompleted ? 0 : parentHeight }}
      transition={{ type: "spring", duration: 0.4 }}
    >
      <AnimatePresence initial={false} mode="sync" custom={direction}>
        {!isCompleted && (
          <SlideTransition key={currentStep} direction={direction} onHeightReady={(h) => setParentHeight(h)}>
            {children}
          </SlideTransition>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SlideTransition({
  children,
  direction,
  onHeightReady,
}: {
  children: ReactNode;
  direction: number;
  onHeightReady: (h: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (containerRef.current) onHeightReady(containerRef.current.offsetHeight);
  }, [children, onHeightReady]);

  return (
    <motion.div
      ref={containerRef}
      custom={direction}
      variants={stepVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.4 }}
      style={{ position: "absolute", left: 0, right: 0, top: 0 }}
    >
      {children}
    </motion.div>
  );
}

const stepVariants = {
  enter: (dir: number) => ({ x: dir >= 0 ? "-100%" : "100%", opacity: 0 }),
  center: { x: "0%", opacity: 1 },
  exit: (dir: number) => ({ x: dir >= 0 ? "50%" : "-50%", opacity: 0 }),
};

export function Step({ children }: { children: ReactNode }) {
  // Horizontal padding lives here (not on the relative wrapper): the wrapper's
  // sliding child is position:absolute and would ignore the wrapper's padding,
  // spilling wider than the indicator row. Padding here insets the content so
  // it aligns with the dots and footer (all px-6 / md:px-8).
  return <div className="px-6 pt-6 pb-1 md:px-8 md:pt-7">{children}</div>;
}

function StepIndicator({
  step,
  currentStep,
  onClickStep,
  disableStepIndicators,
}: {
  step: number;
  currentStep: number;
  onClickStep: (step: number) => void;
  disableStepIndicators?: boolean;
}) {
  const status = currentStep === step ? "active" : currentStep < step ? "inactive" : "complete";

  const handleClick = () => {
    if (step !== currentStep && !disableStepIndicators) onClickStep(step);
  };

  return (
    <motion.div
      onClick={handleClick}
      className="relative outline-none"
      style={disableStepIndicators ? { pointerEvents: "none" } : { cursor: "pointer" }}
      animate={status}
      initial={false}
    >
      <motion.div
        variants={{
          inactive: { scale: 1, backgroundColor: "#eef1ee", color: "#939598" },
          active: { scale: 1, backgroundColor: MINT, color: "#ffffff" },
          complete: { scale: 1, backgroundColor: MINT, color: "#ffffff" },
        }}
        transition={{ duration: 0.3 }}
        className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold"
      >
        {status === "complete" ? (
          <CheckIcon className="h-4 w-4 text-white" />
        ) : status === "active" ? (
          <div className="h-3 w-3 rounded-full bg-white" />
        ) : (
          <span className="text-sm">{step}</span>
        )}
      </motion.div>
    </motion.div>
  );
}

function StepConnector({ isComplete }: { isComplete: boolean }) {
  // Width only. The fill used to animate backgroundColor "transparent" → mint
  // as well, which Motion warns about and refuses: `transparent` is a keyword,
  // not a colour it can interpolate from. It was never needed — the bar is
  // zero-width when incomplete, so there is nothing to see the colour of. Same
  // shape as Stepper2's connector, which sets the colour as a static class.
  const lineVariants = {
    incomplete: { width: 0 },
    complete: { width: "100%" },
  };

  return (
    <div className="relative mx-2 h-0.5 flex-1 overflow-hidden rounded bg-cb-mint/15">
      <motion.div
        className="absolute left-0 top-0 h-full bg-cb-mint"
        variants={lineVariants}
        initial={false}
        animate={isComplete ? "complete" : "incomplete"}
        transition={{ duration: 0.4 }}
      />
    </div>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <motion.path
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 0.1, type: "tween", ease: "easeOut", duration: 0.3 }}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}
