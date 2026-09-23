export type User = { id: number; name: string; role: string };
export type Rules = {
  minimum: number;
  maximum: number;
  step: number;
  mode: string;
};
export type Act = {
  id: string;
  name: string;
  category: string;
  bio: string;
  state: string;
  position: number;
  members?: string[];
  panel?: number[];
  self_locked?: boolean;
  submitted?: string[];
  my_score?: { value: number };
  result?: {
    average: number;
    self_score: number;
    difference: number;
    match: boolean;
  };
  scores?: Record<string, { value: number }>;
};
export type Event = {
  registration_open?: boolean;
  judge_names?: Record<string, string>;
  timer_remaining?: number | null;
  my_registration?: { id: string; name: string; state: string } | null;
  title: string;
  club: string;
  phase: string;
  revision: number;
  announcement: string;
  rules: Rules;
  judges: number[];
  participants: Act[];
  voting_open: boolean;
  my_vote: string | null;
  timer_end: number | null;
  audience_results?: Record<string, number>;
};
export type Command = (
  action: string,
  payload?: Record<string, unknown>,
  participant_id?: string,
) => Promise<boolean>;
