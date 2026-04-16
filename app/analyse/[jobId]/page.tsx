/**
 * /analyse/[jobId] — Property analysis result page.
 *
 * Server Component wrapper. The jobId may be either:
 *  - An analysis_jobs UUID → ResultView polls until complete
 *  - An analysis_cache UUID → ResultView fetches the cached result immediately
 *
 * This gives every analysis a stable, shareable URL.
 */
import type { Metadata } from 'next'
import { ResultView } from './ResultView'

export const metadata: Metadata = {
  title: 'Property Analysis — Qolify',
  description: 'Hidden DNA Report: flood risk, true monthly cost, school proximity, building health and more.',
}

interface Props {
  params:      Promise<{ jobId: string }>
  searchParams: Promise<{ back?: string; lat?: string; lng?: string }>
}

export default async function ResultPage({ params, searchParams }: Props) {
  const { jobId } = await params
  const sp = await searchParams
  return (
    <ResultView
      jobId={jobId}
      backToMap={sp.back === 'map'}
      backLat={sp.lat}
      backLng={sp.lng}
    />
  )
}
