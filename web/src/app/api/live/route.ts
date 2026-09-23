import { db, eventId } from "@/lib/db";
export async function GET() {
  try {
    const sql = db(),
      e = eventId();
    const [event] =
      await sql`select title,phase,voting_open,announcement,revision,match_mode from fgl.events where id=${e}`;
    const performances =
      await sql`select id,name,category,bio,members,position,state,timer_end from fgl.performances where event_id=${e} order by position`;
    const results =
      await sql`select * from fgl.results where event_id=${e} order by judge_rank,name`;
    const audience =
      event?.phase === "ENDED"
        ? await sql`select performance_id,avg((creativity+entertainment+originality)/3.0)::float average,count(*)::int votes from fgl.audience_votes where event_id=${e} group by performance_id`
        : [];
    return Response.json(
      { event, performances, results, audience },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3, stale-while-revalidate=2",
        },
      },
    );
  } catch {
    return Response.json(
      { error: "Live event unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
