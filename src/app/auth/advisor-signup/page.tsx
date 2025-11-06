import { AdvisorSignUpForm } from "@/components/advisor-sign-up-form";


export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-4xl mx-auto">
        <AdvisorSignUpForm/>
      </div>
    </div>
  );
}