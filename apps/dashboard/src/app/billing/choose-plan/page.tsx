import PlanSelector from "@/components/billing/PlanSelector";

export default function ChoosePlanPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-4xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Choose your plan</h1>
          <p className="mt-2 text-gray-500">
            Start with a 14-day free trial. No charge until your trial ends.
          </p>
        </div>
        <PlanSelector />
      </div>
    </div>
  );
}
