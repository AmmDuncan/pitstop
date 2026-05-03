export type PokeArgs = {
  sessionId: string;
  clientSessionId?: string;
  context: string;
};

export type PokeResult = {
  pid: number;
  exited: Promise<number>;
};

export interface Poke {
  trigger(args: PokeArgs): Promise<PokeResult>;
}
