export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(path.startsWith('/api') ? path : `/api${path}`, {
    ...options,
    headers,
    credentials: 'include'
  });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof body === 'object' && body?.error ? body.error : `Falha na requisição (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export const post = <T = any>(path: string, body?: unknown) =>
  api<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body)
  });

export const patch = <T = any>(path: string, body: unknown) =>
  api<T>(path, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });

export const put = <T = any>(path: string, body: unknown) =>
  api<T>(path, {
    method: 'PUT',
    body: JSON.stringify(body)
  });

export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

export function brl(value: number | undefined | null) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

export function number(value: number | undefined | null, digits = 1) {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value || 0));
}

export function statusLabel(status = '') {
  const labels: Record<string, string> = {
    pendente_complemento: 'Completar dados',
    bloqueio_fiscal: 'Bloqueio fiscal',
    pendente: 'Pendente',
    alocado_no_bau: 'No carregamento',
    em_rota: 'Em rota',
    cancelado_em_rota: 'Cancelado em rota',
    entregue: 'Entregue',
    entregue_parcial: 'Entrega parcial',
    ocorrencia: 'Ocorrência',
    reagendado_d1: 'Reagendado D+1',
    baixado_avaria: 'Baixado por avaria',
    disponivel: 'Disponível',
    em_carregamento: 'Em carregamento',
    manutencao: 'Manutenção',
    em_planejamento: 'Planejamento'
  };
  return labels[status] || status.replaceAll('_', ' ');
}
