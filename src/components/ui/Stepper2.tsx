'use client';

import React, {
  useState,
  Children,
  useRef,
  useLayoutEffect,
  HTMLAttributes,
  ReactNode,
} from 'react';
import { motion, AnimatePresence, Variants } from 'framer-motion';

interface StepperProps extends HTMLAttributes<HTMLDivElement> {
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
  /**
   * Default: finishing the last step collapses the card to nothing (wizard
   * behavior). Set false on marketing surfaces where the final button is a CTA
   * — `onFinalStepCompleted` still fires, but the last step stays on screen so
   * the section doesn't turn into an empty band.
   */
  collapseOnComplete?: boolean;
  disableStepIndicators?: boolean;
  renderStepIndicator?: (props: {
    step: number;
    currentStep: number;
    onStepClick: (clicked: number) => void;
  }) => ReactNode;
}

export default function Stepper({
  children,
  initialStep = 1,
  onStepChange = () => {},
  onFinalStepCompleted = () => {},
  stepCircleContainerClassName = '',
  stepContainerClassName = '',
  contentClassName = '',
  footerClassName = '',
  backButtonProps = {},
  nextButtonProps = {},
  backButtonText = 'Back',
  nextButtonText = 'Continue',
  completeButtonText = 'Done',
  collapseOnComplete = true,
  disableStepIndicators = false,
  renderStepIndicator,
  ...rest
}: StepperProps) {
  const [currentStep, setCurrentStep] = useState<number>(initialStep);
  const [direction, setDirection] = useState<number>(0);
  const stepsArray = Children.toArray(children);
  const totalSteps = stepsArray.length;
  const isCompleted = currentStep > totalSteps;
  const isLastStep = currentStep === totalSteps;

  const updateStep = (newStep: number) => {
    setCurrentStep(newStep);
    if (newStep > totalSteps) {
      onFinalStepCompleted();
    } else {
      onStepChange(newStep);
    }
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
    if (!collapseOnComplete) {
      onFinalStepCompleted();
      return;
    }
    setDirection(1);
    updateStep(totalSteps + 1);
  };

  return (
    <div className="w-full" {...rest}>
      <div
        className={`mx-auto w-full rounded-2xl bg-surface-container-lowest border border-outline-variant/30 shadow-lg ${stepCircleContainerClassName}`}
      >
        <div
          className={`${stepContainerClassName} flex w-full items-center px-6 pt-6 pb-2`}
        >
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
                {isNotLastStep && (
                  <StepConnector isComplete={currentStep > stepNumber} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        <StepContentWrapper
          isCompleted={isCompleted}
          currentStep={currentStep}
          direction={direction}
          className={`pt-2 ${contentClassName}`}
          steps={stepsArray}
        >
          {stepsArray[currentStep - 1]}
        </StepContentWrapper>

        {!isCompleted && (
          <div className={`px-6 pb-6 ${footerClassName}`}>
            <div
              className={`mt-6 flex ${
                currentStep !== 1 ? 'justify-between' : 'justify-end'
              }`}
            >
              {currentStep !== 1 && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-wider text-on-surface-variant transition-colors hover:text-primary"
                  {...backButtonProps}
                >
                  {backButtonText}
                </button>
              )}
              <button
                type="button"
                onClick={isLastStep ? handleComplete : handleNext}
                className="signature-gradient text-white px-6 py-2.5 rounded-lg font-bold text-sm uppercase tracking-widest shadow-md transition-transform hover:-translate-y-0.5"
                {...nextButtonProps}
              >
                {isLastStep ? completeButtonText : nextButtonText}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface StepContentWrapperProps {
  isCompleted: boolean;
  currentStep: number;
  direction: number;
  children: ReactNode;
  className?: string;
  steps: ReactNode[];
}

function StepContentWrapper({
  isCompleted,
  currentStep,
  direction,
  children,
  className = '',
  steps,
}: StepContentWrapperProps) {
  // Lock the card to the tallest step so it doesn't grow/shrink between steps.
  // A hidden layer renders every step stacked; we track the max measured height
  // and re-measure on resize so the lock stays correct as text rewraps.
  const [maxHeight, setMaxHeight] = useState<number>(0);
  const measureRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const measure = () => {
      let tallest = 0;
      root
        .querySelectorAll<HTMLElement>('[data-step-measure]')
        .forEach((el) => {
          tallest = Math.max(tallest, el.offsetHeight);
        });
      setMaxHeight(tallest);
    };
    measure();
    const ro = new ResizeObserver(measure);
    root
      .querySelectorAll<HTMLElement>('[data-step-measure]')
      .forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [steps]);

  return (
    <motion.div
      style={{ position: 'relative', overflow: 'hidden' }}
      animate={{ height: isCompleted ? 0 : maxHeight }}
      transition={{ type: 'spring', duration: 0.4 }}
      className={className}
    >
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute inset-x-0 top-0"
      >
        {steps.map((step, i) => (
          <div key={i} data-step-measure className="absolute inset-x-0 top-0">
            {step}
          </div>
        ))}
      </div>

      <AnimatePresence initial={false} mode="sync" custom={direction}>
        {!isCompleted && (
          <SlideTransition key={currentStep} direction={direction}>
            {children}
          </SlideTransition>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface SlideTransitionProps {
  children: ReactNode;
  direction: number;
}

function SlideTransition({ children, direction }: SlideTransitionProps) {
  return (
    <motion.div
      custom={direction}
      variants={stepVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.4 }}
      style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
    >
      {children}
    </motion.div>
  );
}

const stepVariants: Variants = {
  enter: (dir: number) => ({
    x: dir >= 0 ? '40%' : '-40%',
    opacity: 0,
  }),
  center: {
    x: '0%',
    opacity: 1,
  },
  exit: (dir: number) => ({
    x: dir >= 0 ? '-40%' : '40%',
    opacity: 0,
  }),
};

interface StepProps {
  children: ReactNode;
}

export function Step({ children }: StepProps) {
  return <div className="px-8 pb-4">{children}</div>;
}

interface StepIndicatorProps {
  step: number;
  currentStep: number;
  onClickStep: (clicked: number) => void;
  disableStepIndicators?: boolean;
}

function StepIndicator({
  step,
  currentStep,
  onClickStep,
  disableStepIndicators = false,
}: StepIndicatorProps) {
  const status =
    currentStep === step
      ? 'active'
      : currentStep < step
        ? 'inactive'
        : 'complete';

  const handleClick = () => {
    if (step !== currentStep && !disableStepIndicators) {
      onClickStep(step);
    }
  };

  return (
    <motion.div
      onClick={handleClick}
      className={`relative outline-none focus:outline-none ${disableStepIndicators ? 'pointer-events-none opacity-50' : 'cursor-pointer'}`}
      animate={status}
      initial={false}
    >
      <motion.div
        variants={{
          inactive: { scale: 1, backgroundColor: '#e3e2e0', color: '#939598' },
          active: { scale: 1.05, backgroundColor: '#55cf9e', color: '#202536' },
          complete: { scale: 1, backgroundColor: '#55cf9e', color: '#ffffff' },
        }}
        transition={{ duration: 0.3 }}
        className="flex h-9 w-9 items-center justify-center rounded-full font-bold shadow-sm"
      >
        {status === 'complete' ? (
          <CheckIcon className="h-5 w-5" />
        ) : status === 'active' ? (
          <span className="text-sm">{step}</span>
        ) : (
          <span className="text-sm">{step}</span>
        )}
      </motion.div>
    </motion.div>
  );
}

interface StepConnectorProps {
  isComplete: boolean;
}

function StepConnector({ isComplete }: StepConnectorProps) {
  const lineVariants: Variants = {
    incomplete: { width: '0%' },
    complete: { width: '100%' },
  };

  return (
    <div className="relative mx-3 h-0.5 flex-1 overflow-hidden rounded bg-outline-variant/40">
      <motion.div
        className="absolute left-0 top-0 h-full bg-primary"
        variants={lineVariants}
        initial={false}
        animate={isComplete ? 'complete' : 'incomplete'}
        transition={{ duration: 0.4 }}
      />
    </div>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <motion.path
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{
          delay: 0.1,
          type: 'tween',
          ease: 'easeOut',
          duration: 0.3,
        }}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}
