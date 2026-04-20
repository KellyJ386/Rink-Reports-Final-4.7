import { CreateFacilityClient } from './client'

export default function NewFacilityPage() {
  return (
    <main>
      <h1 className="text-xl font-semibold">Create facility</h1>
      <p className="text-muted text-sm mt-1">
        Creates the facility, starts a 30-day trial, enables all modules, and issues
        the first-admin invite. Deliver the returned invite URL to the facility admin
        via email or Slack.
      </p>
      <div className="mt-6">
        <CreateFacilityClient />
      </div>
    </main>
  )
}
