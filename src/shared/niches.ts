/**
 * Modelos de nicho do assistente de primeiro acesso.
 *
 * Cada nicho tem perguntas e uma função `build` que, a partir das respostas,
 * monta funil, etiquetas, mensagens rápidas, setores, campos da ficha do lead
 * e instruções da IA. O mesmo código roda no navegador (prévia) e no servidor
 * (o que é gravado): o servidor NUNCA grava conteúdo vindo do front, só as
 * respostas, que são filtradas pelas opções conhecidas.
 */

export const NICHE_KEYS = ["advocacia", "arquitetura", "saude", "imobiliaria", "outro"] as const;
export type NicheKey = (typeof NICHE_KEYS)[number];

export const FIELD_TYPES = ["texto", "numero", "data", "opcoes", "sim_nao"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  texto: "Texto",
  numero: "Número",
  data: "Data",
  opcoes: "Lista de opções",
  sim_nao: "Sim / Não",
};

export interface SetupStage { name: string; color: string; is_won?: boolean; is_lost?: boolean }
export interface SetupTag { name: string; color: string }
export interface SetupQuickReply { shortcut: string; title: string; body: string }
export interface SetupDepartment { name: string; color: string }
export interface SetupField { key: string; label: string; type: FieldType; options?: string[] }
export interface SetupAi {
  niche: string;
  business_area: string;
  company_description: string | null;
  tone: "formal" | "amigavel" | "descontraido";
  rules: string;
  greeting: string;
  services: { name: string; description: string; price: string }[];
  faq: { question: string; answer: string }[];
}
export interface NicheSetup {
  stages: SetupStage[];
  tags: SetupTag[];
  quick_replies: SetupQuickReply[];
  departments: SetupDepartment[];
  contact_fields: SetupField[];
  ai: SetupAi;
}

export const SETUP_GROUPS = ["stages", "tags", "quick_replies", "departments", "contact_fields", "ai"] as const;
export type SetupGroup = (typeof SETUP_GROUPS)[number];
export const SETUP_GROUP_LABEL: Record<SetupGroup, string> = {
  stages: "Etapas do funil",
  tags: "Etiquetas (WhatsApp e contatos)",
  quick_replies: "Mensagens rápidas do WhatsApp",
  departments: "Setores",
  contact_fields: "Informações extras da ficha do lead",
  ai: "Instruções do Atendimento IA",
};

export interface Option { value: string; label: string }
export interface Question {
  id: string;
  label: string;
  help?: string;
  type: "multi" | "single" | "text";
  options?: Option[];
  default?: string | string[];
  placeholder?: string;
  max?: number;
}

export type Answers = Record<string, string | string[] | undefined>;

export interface NicheDef {
  key: NicheKey;
  label: string;
  description: string;
  questions: Question[];
  build: (a: Answers, companyName: string) => NicheSetup;
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

const PALETTE = ["#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#f59e0b", "#14b8a6", "#ef4444", "#22c55e", "#f97316", "#64748b", "#84cc16", "#06b6d4"];
const color = (i: number) => PALETTE[i % PALETTE.length]!;

const yesNo: Option[] = [
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
];

/** Respostas de múltipla escolha, filtradas pelas opções conhecidas. */
function picked(q: Question, a: Answers): Option[] {
  const raw = a[q.id] ?? q.default ?? [];
  const values = new Set(Array.isArray(raw) ? raw : [raw]);
  return (q.options ?? []).filter((o) => values.has(o.value));
}
function single(q: Question, a: Answers): string {
  const raw = a[q.id] ?? q.default;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (q.options ?? []).some((o) => o.value === v) ? (v as string) : ((q.default as string) ?? "");
}
function text(q: Question, a: Answers): string {
  const raw = a[q.id];
  const v = typeof raw === "string" ? raw.trim() : "";
  return v.slice(0, q.max ?? 300);
}

const TONE_Q: Question = {
  id: "tom",
  label: "Como deve ser o tom do atendimento?",
  type: "single",
  options: [
    { value: "formal", label: "Formal" },
    { value: "amigavel", label: "Amigável e profissional" },
    { value: "descontraido", label: "Descontraído" },
  ],
  default: "amigavel",
};
const ABOUT_Q: Question = {
  id: "sobre",
  label: "Em poucas palavras, o que a empresa faz e onde atende?",
  help: "Usado nas instruções da IA. Pode deixar em branco e completar depois.",
  type: "text",
  placeholder: "Ex.: Escritório em Curitiba, atendimento presencial e online para todo o Brasil.",
  max: 600,
};
const SECTORS_Q = (label: string): Question => ({
  id: "setores",
  label,
  help: "Setores limitam quem vê cada lead (ex.: a equipe do trabalhista só vê os leads do trabalhista).",
  type: "single",
  options: yesNo,
  default: "nao",
});

const tone = (a: Answers) => single(TONE_Q, a) as SetupAi["tone"];
const about = (a: Answers) => text(ABOUT_Q, a) || null;

function welcome(companyName: string, extra: string) {
  return `Olá! Aqui é da ${companyName}. Obrigado pelo contato 😊 ${extra}`;
}

// ---------------------------------------------------------------------------
// Advocacia
// ---------------------------------------------------------------------------

const ADV_AREAS: Question = {
  id: "areas",
  label: "Quais áreas o escritório atende?",
  type: "multi",
  options: [
    { value: "trabalhista", label: "Trabalhista" },
    { value: "previdenciario", label: "Previdenciário (INSS)" },
    { value: "familia", label: "Família e sucessões" },
    { value: "civel", label: "Cível" },
    { value: "consumidor", label: "Consumidor" },
    { value: "criminal", label: "Criminal" },
    { value: "tributario", label: "Tributário" },
    { value: "empresarial", label: "Empresarial" },
    { value: "bancario", label: "Bancário" },
    { value: "imobiliario", label: "Imobiliário" },
    { value: "saude", label: "Direito médico / saúde" },
  ],
  default: ["trabalhista", "previdenciario", "familia", "civel"],
};
const ADV_ONLINE: Question = { id: "online", label: "Atendem por consulta online (vídeo)?", type: "single", options: yesNo, default: "sim" };
const ADV_SECTORS = SECTORS_Q("Criar um setor para cada área?");

const advocacia: NicheDef = {
  key: "advocacia",
  label: "Advocacia",
  description: "Escritórios e advogados autônomos",
  questions: [ADV_AREAS, ADV_ONLINE, ADV_SECTORS, ABOUT_Q, { ...TONE_Q, default: "formal" }],
  build(a, company) {
    const areas = picked(ADV_AREAS, a);
    const online = single(ADV_ONLINE, a) === "sim";
    const areaNames = areas.map((x) => x.label);
    return {
      stages: [
        { name: "Novo lead", color: "#0ea5e9" },
        { name: "Triagem do caso", color: "#6366f1" },
        { name: "Consulta agendada", color: "#a855f7" },
        { name: "Documentos pendentes", color: "#f59e0b" },
        { name: "Proposta de honorários", color: "#f97316" },
        { name: "Contrato assinado", color: "#22c55e", is_won: true },
        { name: "Não fechou", color: "#ef4444", is_lost: true },
      ],
      tags: [
        ...areas.map((x, i) => ({ name: x.label, color: color(i) })),
        { name: "Urgente", color: "#ef4444" },
        { name: "Retornar contato", color: "#f59e0b" },
        { name: "Indicação", color: "#22c55e" },
        { name: "Tráfego pago", color: "#a100ff" },
      ],
      quick_replies: [
        { shortcut: "boasvindas", title: "Boas-vindas", body: welcome(company, "Para entender o seu caso, pode me contar em poucas palavras o que aconteceu?") },
        { shortcut: "triagem", title: "Perguntas de triagem", body: "Para eu encaminhar ao advogado responsável, me conte:\n1. Qual é a situação?\n2. Quando aconteceu?\n3. Já existe algum processo em andamento?\n4. Qual a sua cidade?" },
        { shortcut: "documentos", title: "Pedir documentos", body: "Para analisarmos o seu caso, envie por aqui, por favor:\n• Documento com foto (RG ou CNH)\n• Comprovante de residência\n• Documentos relacionados ao caso (contratos, prints, laudos, etc.)" },
        { shortcut: "agendar", title: "Agendar consulta", body: `Vamos agendar a sua consulta${online ? " (pode ser presencial ou por vídeo)" : ""}. Qual o melhor dia e horário para você?` },
        { shortcut: "honorarios", title: "Sobre honorários", body: "Os honorários são definidos após a análise do seu caso na consulta, conforme a complexidade e a tabela da OAB. Posso agendar um horário para você?" },
        { shortcut: "retorno", title: "Retorno", body: "Olá! Passando para saber se você conseguiu separar os documentos ou se ficou alguma dúvida. Estou à disposição." },
      ],
      departments: single(ADV_SECTORS, a) === "sim" ? areas.map((x, i) => ({ name: x.label.slice(0, 60), color: color(i) })) : [],
      contact_fields: [
        ...(areaNames.length ? [{ key: "area_direito", label: "Área do direito", type: "opcoes" as const, options: areaNames }] : []),
        { key: "resumo_caso", label: "Resumo do caso", type: "texto" },
        { key: "numero_processo", label: "Nº do processo", type: "texto" },
        { key: "parte_contraria", label: "Parte contrária", type: "texto" },
        { key: "proximo_prazo", label: "Próximo prazo", type: "data" },
        { key: "tipo_honorarios", label: "Tipo de honorários", type: "opcoes", options: ["Fixo", "Êxito", "Fixo + êxito"] },
      ],
      ai: {
        niche: "Advocacia",
        business_area: areaNames.length ? `Escritório de advocacia: ${areaNames.join(", ")}` : "Escritório de advocacia",
        company_description: about(a),
        tone: tone(a),
        rules: [
          "Siga o Código de Ética da OAB e o Provimento 205/2021.",
          "Nunca prometa resultado, ganho de causa, prazo de decisão ou valor de indenização.",
          "Não dê parecer jurídico nem diga se a pessoa tem ou não direito: colete os fatos e encaminhe para o advogado.",
          "Não informe valores de honorários: explique que são definidos após a análise do caso.",
          "Pergunte o que aconteceu, quando, a cidade e se já existe processo. Em caso de prazo urgente (audiência, prisão, prazo judicial), chame um humano imediatamente.",
        ].join("\n"),
        greeting: `Olá! Sou o assistente virtual da ${company}. Me conte em poucas palavras como podemos ajudar no seu caso.`,
        services: areas.map((x) => ({ name: `Direito ${x.label.replace(/^Direito /, "")}`.slice(0, 120), description: "", price: "" })),
        faq: online
          ? [{ question: "Vocês atendem online?", answer: "Sim. A consulta pode ser presencial ou por chamada de vídeo, com a mesma segurança e sigilo." }]
          : [],
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Arquitetura
// ---------------------------------------------------------------------------

const ARQ_SERV: Question = {
  id: "servicos",
  label: "Quais serviços vocês oferecem?",
  type: "multi",
  options: [
    { value: "residencial", label: "Projeto residencial" },
    { value: "comercial", label: "Projeto comercial" },
    { value: "interiores", label: "Design de interiores" },
    { value: "reforma", label: "Reforma" },
    { value: "obra", label: "Acompanhamento de obra" },
    { value: "paisagismo", label: "Paisagismo" },
    { value: "regularizacao", label: "Regularização / aprovação na prefeitura" },
    { value: "3d", label: "Projeto 3D / render" },
  ],
  default: ["residencial", "interiores", "reforma"],
};
const ARQ_SECTORS = SECTORS_Q("Separar a equipe em setores (Comercial, Projetos e Obras)?");

const arquitetura: NicheDef = {
  key: "arquitetura",
  label: "Arquitetura e interiores",
  description: "Escritórios de arquitetura, design de interiores e reformas",
  questions: [ARQ_SERV, ARQ_SECTORS, ABOUT_Q, TONE_Q],
  build(a, company) {
    const serv = picked(ARQ_SERV, a);
    return {
      stages: [
        { name: "Novo contato", color: "#0ea5e9" },
        { name: "Briefing", color: "#6366f1" },
        { name: "Visita técnica", color: "#a855f7" },
        { name: "Proposta enviada", color: "#f59e0b" },
        { name: "Negociação", color: "#f97316" },
        { name: "Contrato fechado", color: "#22c55e", is_won: true },
        { name: "Perdido", color: "#ef4444", is_lost: true },
      ],
      tags: [
        ...serv.map((x, i) => ({ name: x.label.slice(0, 50), color: color(i) })),
        { name: "Alto padrão", color: "#a100ff" },
        { name: "Indicação", color: "#22c55e" },
        { name: "Retornar contato", color: "#f59e0b" },
      ],
      quick_replies: [
        { shortcut: "boasvindas", title: "Boas-vindas", body: welcome(company, "Me conta um pouco do seu projeto: é casa, apartamento ou espaço comercial?") },
        { shortcut: "briefing", title: "Perguntas do briefing", body: "Para prepararmos a proposta, me conte:\n1. Tipo de imóvel e metragem aproximada\n2. Bairro/cidade\n3. O que deseja fazer (projeto novo, reforma, interiores)\n4. Prazo desejado\n5. Faixa de investimento prevista" },
        { shortcut: "visita", title: "Agendar visita técnica", body: "Podemos agendar uma visita técnica ao local para entender melhor o espaço. Qual o melhor dia e horário?" },
        { shortcut: "planta", title: "Pedir planta e fotos", body: "Se tiver, envie a planta do imóvel e algumas fotos/vídeos do espaço atual. Isso agiliza bastante a proposta." },
        { shortcut: "proposta", title: "Proposta enviada", body: "Acabei de enviar a proposta. Fico à disposição para tirar dúvidas ou ajustar o escopo." },
        { shortcut: "portfolio", title: "Portfólio", body: "Você pode conhecer alguns dos nossos projetos no nosso Instagram/portfólio. Quer que eu envie alguns parecidos com o que você procura?" },
      ],
      departments:
        single(ARQ_SECTORS, a) === "sim"
          ? [
              { name: "Comercial", color: "#0ea5e9" },
              { name: "Projetos", color: "#a855f7" },
              { name: "Obras", color: "#f59e0b" },
            ]
          : [],
      contact_fields: [
        { key: "tipo_imovel", label: "Tipo de imóvel", type: "opcoes", options: ["Casa", "Apartamento", "Sala comercial", "Loja", "Terreno", "Outro"] },
        { key: "metragem", label: "Metragem (m²)", type: "numero" },
        { key: "localizacao", label: "Bairro / cidade da obra", type: "texto" },
        { key: "investimento", label: "Faixa de investimento", type: "opcoes", options: ["Até R$ 50 mil", "R$ 50 a 150 mil", "R$ 150 a 500 mil", "Acima de R$ 500 mil"] },
        { key: "prazo_desejado", label: "Prazo desejado", type: "data" },
        { key: "possui_planta", label: "Tem planta do imóvel?", type: "sim_nao" },
      ],
      ai: {
        niche: "Arquitetura e interiores",
        business_area: serv.length ? `Escritório de arquitetura: ${serv.map((x) => x.label).join(", ")}` : "Escritório de arquitetura",
        company_description: about(a),
        tone: tone(a),
        rules: [
          "Não informe valor fechado de projeto ou obra sem briefing: explique que a proposta depende do escopo.",
          "Colete tipo de imóvel, metragem, bairro/cidade, o que a pessoa quer fazer, prazo e faixa de investimento.",
          "Peça planta e fotos do espaço quando fizer sentido.",
          "Ofereça agendar uma reunião de briefing ou visita técnica com a equipe.",
        ].join("\n"),
        greeting: `Olá! Sou o assistente virtual da ${company}. Me conta um pouco do seu projeto?`,
        services: serv.map((x) => ({ name: x.label, description: "", price: "" })),
        faq: [],
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Clínicas / saúde
// ---------------------------------------------------------------------------

const SAU_ESPEC: Question = {
  id: "especialidades",
  label: "Quais especialidades ou serviços a clínica oferece?",
  type: "multi",
  options: [
    { value: "odontologia", label: "Odontologia" },
    { value: "ortodontia", label: "Ortodontia" },
    { value: "implantes", label: "Implantes" },
    { value: "harmonizacao", label: "Harmonização facial" },
    { value: "estetica", label: "Estética" },
    { value: "dermatologia", label: "Dermatologia" },
    { value: "clinica_geral", label: "Clínica médica" },
    { value: "fisioterapia", label: "Fisioterapia" },
    { value: "psicologia", label: "Psicologia" },
    { value: "nutricao", label: "Nutrição" },
    { value: "exames", label: "Exames" },
  ],
  default: ["odontologia", "estetica"],
};
const SAU_CONVENIO: Question = { id: "convenio", label: "Atendem convênio?", type: "single", options: yesNo, default: "nao" };
const SAU_SECTORS = SECTORS_Q("Separar a equipe em setores (Recepção, Avaliação e Atendimento)?");

const saude: NicheDef = {
  key: "saude",
  label: "Clínicas e saúde",
  description: "Clínicas odontológicas, médicas, estética, fisioterapia e afins",
  questions: [SAU_ESPEC, SAU_CONVENIO, SAU_SECTORS, ABOUT_Q, TONE_Q],
  build(a, company) {
    const esp = picked(SAU_ESPEC, a);
    const convenio = single(SAU_CONVENIO, a) === "sim";
    return {
      stages: [
        { name: "Novo contato", color: "#0ea5e9" },
        { name: "Avaliação agendada", color: "#6366f1" },
        { name: "Compareceu", color: "#a855f7" },
        { name: "Plano de tratamento enviado", color: "#f59e0b" },
        { name: "Paciente ativo", color: "#22c55e", is_won: true },
        { name: "Não fechou", color: "#ef4444", is_lost: true },
      ],
      tags: [
        ...esp.map((x, i) => ({ name: x.label, color: color(i) })),
        { name: "Faltou", color: "#ef4444" },
        { name: "Retorno", color: "#f59e0b" },
        ...(convenio ? [{ name: "Convênio", color: "#14b8a6" }] : []),
        { name: "Particular", color: "#a100ff" },
      ],
      quick_replies: [
        { shortcut: "boasvindas", title: "Boas-vindas", body: welcome(company, "Como posso te ajudar? Quer agendar uma avaliação?") },
        { shortcut: "agendar", title: "Agendar avaliação", body: "Vamos agendar! Qual o melhor dia e período (manhã ou tarde) para você?" },
        { shortcut: "confirmar", title: "Confirmar horário", body: "Olá! Passando para confirmar o seu horário. Pode confirmar a presença respondendo SIM? 😊" },
        { shortcut: "endereco", title: "Endereço", body: "Nosso endereço é: [preencha o endereço]. Se precisar, te mando a localização por aqui." },
        { shortcut: "preparo", title: "Orientações antes da consulta", body: "Para a sua consulta, chegue com 10 minutos de antecedência e traga um documento com foto" + (convenio ? " e a carteirinha do convênio." : ".") },
        { shortcut: "faltou", title: "Remarcar falta", body: "Sentimos sua falta hoje! Quer remarcar para outro dia? Me diga o melhor horário." },
      ],
      departments:
        single(SAU_SECTORS, a) === "sim"
          ? [
              { name: "Recepção", color: "#0ea5e9" },
              { name: "Avaliação", color: "#a855f7" },
              { name: "Atendimento clínico", color: "#22c55e" },
            ]
          : [],
      contact_fields: [
        ...(esp.length ? [{ key: "procedimento", label: "Procedimento de interesse", type: "opcoes" as const, options: esp.map((x) => x.label) }] : []),
        { key: "data_nascimento", label: "Data de nascimento", type: "data" },
        { key: "pagamento", label: "Forma de atendimento", type: "opcoes", options: convenio ? ["Particular", "Convênio"] : ["Particular"] },
        ...(convenio ? [{ key: "convenio_nome", label: "Convênio", type: "texto" as const }] : []),
        { key: "como_conheceu", label: "Como conheceu", type: "opcoes", options: ["Instagram", "Google", "Indicação", "Anúncio", "Outro"] },
        { key: "ultima_consulta", label: "Última consulta", type: "data" },
      ],
      ai: {
        niche: "Clínica / saúde",
        business_area: esp.length ? `Clínica: ${esp.map((x) => x.label).join(", ")}` : "Clínica de saúde",
        company_description: about(a),
        tone: tone(a),
        rules: [
          "Nunca faça diagnóstico, não indique medicamentos nem tratamentos: oriente a agendar uma avaliação.",
          "Não prometa resultados e não fale de 'antes e depois' (normas dos conselhos profissionais).",
          "Em sintomas graves ou urgência, oriente a procurar um pronto atendimento e chame um humano.",
          "Peça apenas os dados necessários para o agendamento (nome, melhor dia e período). Não peça dados de saúde detalhados por mensagem.",
          "Não informe valores de procedimentos sem avaliação, a menos que estejam na lista de serviços.",
        ].join("\n"),
        greeting: `Olá! Sou o assistente virtual da ${company}. Posso te ajudar a agendar uma avaliação?`,
        services: esp.map((x) => ({ name: x.label, description: "", price: "" })),
        faq: [
          {
            question: "Vocês atendem convênio?",
            answer: convenio ? "Sim, atendemos convênio. Me diga qual é o seu para eu verificar." : "No momento atendemos apenas particular.",
          },
        ],
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Imobiliária
// ---------------------------------------------------------------------------

const IMO_OPER: Question = {
  id: "operacoes",
  label: "Com o que a imobiliária trabalha?",
  type: "multi",
  options: [
    { value: "venda", label: "Venda" },
    { value: "locacao", label: "Locação" },
    { value: "lancamentos", label: "Lançamentos" },
    { value: "comercial", label: "Imóveis comerciais" },
    { value: "rural", label: "Imóveis rurais" },
    { value: "administracao", label: "Administração de imóveis" },
  ],
  default: ["venda", "locacao"],
};
const IMO_SECTORS = SECTORS_Q("Separar a equipe em setores (Vendas, Locação e Captação)?");

const imobiliaria: NicheDef = {
  key: "imobiliaria",
  label: "Imobiliária e corretores",
  description: "Imobiliárias, corretores e incorporadoras",
  questions: [IMO_OPER, IMO_SECTORS, ABOUT_Q, TONE_Q],
  build(a, company) {
    const ops = picked(IMO_OPER, a);
    const hasRent = ops.some((o) => o.value === "locacao");
    return {
      stages: [
        { name: "Novo lead", color: "#0ea5e9" },
        { name: "Qualificado", color: "#6366f1" },
        { name: "Visita agendada", color: "#a855f7" },
        { name: "Visita realizada", color: "#14b8a6" },
        { name: "Proposta", color: "#f59e0b" },
        { name: "Negócio fechado", color: "#22c55e", is_won: true },
        { name: "Perdido", color: "#ef4444", is_lost: true },
      ],
      tags: [
        ...ops.map((x, i) => ({ name: x.label, color: color(i) })),
        { name: "Financiamento", color: "#f59e0b" },
        { name: "À vista", color: "#22c55e" },
        { name: "Permuta", color: "#14b8a6" },
        { name: "Investidor", color: "#a100ff" },
      ],
      quick_replies: [
        { shortcut: "boasvindas", title: "Boas-vindas", body: welcome(company, "Você procura imóvel para comprar ou alugar?") },
        { shortcut: "qualificar", title: "Perguntas de qualificação", body: "Para eu separar as melhores opções:\n1. Compra ou locação?\n2. Tipo de imóvel (casa, apartamento...)\n3. Bairros de interesse\n4. Quantos quartos\n5. Faixa de valor\n6. Vai usar financiamento?" },
        { shortcut: "visita", title: "Agendar visita", body: "Que tal agendarmos uma visita? Qual o melhor dia e horário para você?" },
        ...(hasRent
          ? [{ shortcut: "locacao_docs", title: "Documentos para locação", body: "Para a análise da locação, precisamos de:\n• RG e CPF\n• Comprovante de renda (3x o valor do aluguel)\n• Comprovante de residência\n• Garantia (fiador, seguro-fiança ou caução)" }]
          : []),
        { shortcut: "simulacao", title: "Simulação de financiamento", body: "Posso fazer uma simulação de financiamento para você. Me informe a sua renda bruta familiar e o valor de entrada disponível." },
        { shortcut: "opcoes", title: "Enviar opções", body: "Separei algumas opções no seu perfil. Vou te enviar aqui; me diga quais você gostaria de visitar." },
      ],
      departments:
        single(IMO_SECTORS, a) === "sim"
          ? [
              { name: "Vendas", color: "#0ea5e9" },
              ...(hasRent ? [{ name: "Locação", color: "#a855f7" }] : []),
              { name: "Captação", color: "#f59e0b" },
            ]
          : [],
      contact_fields: [
        { key: "interesse", label: "Interesse", type: "opcoes", options: ops.length ? ops.map((x) => x.label) : ["Venda", "Locação"] },
        { key: "tipo_imovel", label: "Tipo de imóvel", type: "opcoes", options: ["Apartamento", "Casa", "Casa em condomínio", "Terreno", "Comercial", "Rural"] },
        { key: "bairros", label: "Bairros de interesse", type: "texto" },
        { key: "quartos", label: "Quartos", type: "numero" },
        { key: "faixa_valor", label: "Faixa de valor", type: "opcoes", options: ["Até R$ 300 mil", "R$ 300 a 600 mil", "R$ 600 mil a 1 milhão", "Acima de R$ 1 milhão"] },
        { key: "financiamento", label: "Vai financiar?", type: "sim_nao" },
        { key: "codigo_imovel", label: "Código do imóvel", type: "texto" },
      ],
      ai: {
        niche: "Imobiliária",
        business_area: ops.length ? `Imobiliária: ${ops.map((x) => x.label).join(", ")}` : "Imobiliária",
        company_description: about(a),
        tone: tone(a),
        rules: [
          "Não confirme disponibilidade, valor final ou condições de um imóvel sem um corretor: diga que vai verificar.",
          "Qualifique o lead: compra ou locação, tipo de imóvel, bairros, quartos, faixa de valor e se vai financiar.",
          "Ofereça agendar visita com um corretor.",
        ].join("\n"),
        greeting: `Olá! Sou o assistente virtual da ${company}. Você procura imóvel para comprar ou alugar?`,
        services: ops.map((x) => ({ name: x.label, description: "", price: "" })),
        faq: [],
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Outro / genérico
// ---------------------------------------------------------------------------

const OUT_SEG: Question = { id: "segmento", label: "Qual é o segmento da empresa?", type: "text", placeholder: "Ex.: escola de idiomas, contabilidade, academia…", max: 120 };

const outro: NicheDef = {
  key: "outro",
  label: "Outro segmento",
  description: "Um funil de vendas padrão, que você ajusta depois",
  questions: [OUT_SEG, ABOUT_Q, TONE_Q],
  build(a, company) {
    const seg = text(OUT_SEG, a);
    return {
      stages: [
        { name: "Novo lead", color: "#0ea5e9" },
        { name: "Qualificado", color: "#6366f1" },
        { name: "Proposta", color: "#f59e0b" },
        { name: "Negociação", color: "#f97316" },
        { name: "Ganho", color: "#22c55e", is_won: true },
        { name: "Perdido", color: "#ef4444", is_lost: true },
      ],
      tags: [
        { name: "Urgente", color: "#ef4444" },
        { name: "Retornar contato", color: "#f59e0b" },
        { name: "Indicação", color: "#22c55e" },
        { name: "Tráfego pago", color: "#a100ff" },
      ],
      quick_replies: [
        { shortcut: "boasvindas", title: "Boas-vindas", body: welcome(company, "Como posso te ajudar?") },
        { shortcut: "retorno", title: "Retorno", body: "Olá! Passando para saber se ficou alguma dúvida. Estou à disposição." },
      ],
      departments: [],
      contact_fields: [{ key: "interesse", label: "Interesse", type: "texto" }],
      ai: {
        niche: seg || "Outro",
        business_area: seg,
        company_description: about(a),
        tone: tone(a),
        rules: "Entenda o que a pessoa precisa, colete nome e melhor horário de contato e ofereça falar com a equipe.",
        greeting: `Olá! Sou o assistente virtual da ${company}. Como posso ajudar?`,
        services: [],
        faq: [],
      },
    };
  },
};

export const NICHES: Record<NicheKey, NicheDef> = { advocacia, arquitetura, saude, imobiliaria, outro };

export function isNicheKey(v: unknown): v is NicheKey {
  return typeof v === "string" && (NICHE_KEYS as readonly string[]).includes(v);
}

/** Monta o que será aplicado, só com os grupos escolhidos. */
export function buildNicheSetup(
  niche: NicheKey,
  answers: Answers,
  companyName: string,
  include: readonly SetupGroup[] = SETUP_GROUPS,
): Partial<NicheSetup> {
  const full = NICHES[niche].build(answers, companyName.trim().slice(0, 80) || "nossa empresa");
  const out: Partial<NicheSetup> = {};
  for (const g of include) (out as Record<string, unknown>)[g] = full[g];
  return out;
}
