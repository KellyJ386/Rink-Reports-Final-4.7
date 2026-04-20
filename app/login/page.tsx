export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  return (
    <main>
      <h1>Sign in</h1>
      {reason === 'deactivated' && (
        <p role="alert">Your account has been deactivated. Contact a facility admin.</p>
      )}
      <p>Login UI is built by Agent 6 / Agent 7. This placeholder exists only so the auth middleware has a redirect target.</p>
    </main>
  )
}
