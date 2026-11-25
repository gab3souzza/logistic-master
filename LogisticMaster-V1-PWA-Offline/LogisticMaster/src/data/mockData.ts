import { Order, Vehicle, DecisionScenario, TrafficEvent, VehiclePresetSpec, AuditLogEntry } from '../types/logistics';

export const VEHICLE_PRESETS: VehiclePresetSpec[] = [
  {
    presetType: 'FIORINO',
    label: '1. Fiorino / Furgão Leve',
    defaultModel: 'Fiat Fiorino Endurance 1.4 Flex',
    maxWeightKg: 650,
    maxVolumeM3: 3.3,
    fuelConsumptionKmL: 10.5,
    zrtcCompliant: true,
    zrtcRuleSummary: 'Livre circulação 24h em ladeiras estreitas, Pelourinho e Centro Histórico.'
  },
  {
    presetType: 'VUC_HR_BONGO',
    label: '2. VUC Urbano (HR / Kia Bongo / Daily)',
    defaultModel: 'Hyundai HR / Kia Bongo K2500 Baú',
    maxWeightKg: 1500,
    maxVolumeM3: 8.0,
    fuelConsumptionKmL: 8.5,
    zrtcCompliant: true,
    zrtcRuleSummary: 'Homologado ZRTC Transalvador (RN-06): Acesso liberado nas zonas de restrição.'
  },
  {
    presetType: 'TRUCK_3_4',
    label: '3. Caminhão 3/4 (VW Delivery / Accelo)',
    defaultModel: 'VW Delivery 9.170 / MB Accelo 815',
    maxWeightKg: 3500,
    maxVolumeM3: 18.0,
    fuelConsumptionKmL: 7.5,
    zrtcCompliant: false,
    zrtcRuleSummary: 'Restrição ZRTC fora da janela (RN-06). Ideal para Miolo Urbano, San Martin e Cajazeiras.'
  },
  {
    presetType: 'TOCO',
    label: '4. Caminhão Toco (Atacado Pesado)',
    defaultModel: 'VW Constellation 14.190 / MB Atego',
    maxWeightKg: 6000,
    maxVolumeM3: 32.0,
    fuelConsumptionKmL: 5.5,
    zrtcCompliant: false,
    zrtcRuleSummary: 'Proibido em ZRTC diurno. Alocado para Eixo Paralela, Subúrbio Ferroviário e RMS.'
  }
];

export const INITIAL_AUDIT_LOGS: AuditLogEntry[] = [
  {
    id: 'aud-01',
    timestamp: '06:12:04',
    sourceType: 'XML_NFE',
    documentRef: 'NF-e #10452 (Mercadinho Santana)',
    key44OrCnpj: '29261012345678000190550010000104521482910315',
    anomalyDetected: 'Valor de lote global no cabeçalho (15 cx Óleo a R$ 1.650,00) + Lote LT-SOJ-26A com 35 dias de validade',
    autoCorrectionApplied: 'Batch-to-Unit Sanitizer: Desmembrado para R$ 110,00/cx | Prioridade FEFO URGENTE aplicada (RN-03)',
    severity: 'corrigido_auto',
    humanApproved: true
  },
  {
    id: 'aud-02',
    timestamp: '06:14:22',
    sourceType: 'XML_NFE',
    documentRef: 'NF-e #10453 (Delicatessen Doce Pão)',
    key44OrCnpj: '29261012345678000190550010000104531839201922',
    anomalyDetected: 'Tag <rastro> detectou Lote LT-LAT-88B com validade residual de 37 dias (<= 65d RN-03)',
    autoCorrectionApplied: 'Classificado automaticamente como FEFO URGENTE + Topo Frágil (FRAGILE_TOP)',
    severity: 'corrigido_auto',
    humanApproved: true
  },
  {
    id: 'aud-03',
    timestamp: '06:18:45',
    sourceType: 'CANHOTO_OCR',
    documentRef: 'Padrão Histórico CNPJ 14.829.103/0001-45',
    key44OrCnpj: '14.829.103/0001-45',
    anomalyDetected: '3ª entrega concluída no cliente (Gatilho Cold Start to Smart RN-13)',
    autoCorrectionApplied: 'Média Móvel Simples (MMS) recalculou tempo de descarga de 15 min para 11,4 min (outliers expurgados)',
    severity: 'corrigido_auto',
    humanApproved: true
  }
];

export const INITIAL_ORDERS: Order[] = [
  {
    id: 'ord-10452',
    nfe: '10452',
    accessKey: '29261012345678000190550010000104521482910315',
    customerName: 'SANTANA ALIMENTOS E BEBIDAS LTDA',
    tradeName: 'Mercadinho Santana',
    cnpj: '14.829.103/0001-45',
    address: 'Rua da Paciência, 84',
    neighborhood: 'Rio Vermelho',
    city: 'Salvador',
    state: 'BA',
    cep: '41950-010',
    weightKg: 320,
    volumeM3: 1.8,
    timeWindow: '07:00 - 09:00',
    status: 'em_rota',
    truckId: 'truck-01',
    lifoPosition: 1, // 1st to unload at the door (Zona 1)
    fefoCompliance: 100,
    earliestExpiryDate: '15/12/2026',
    criticalItemName: 'Óleo de Soja (Lote SOJ-26A)',
    totalValue: 3420.50,
    icmsBase: 3420.50,
    icmsValue: 615.69,
    historicalAvgUnloadingMin: 11.4,
    completedDeliveriesCount: 5,
    items: [
      {
        id: 'item-1',
        code: 'ALIM-0102',
        ean13: '7891020304512',
        name: 'Óleo de Soja Refinado Tipo 1 - Caixa 20x900ml',
        ncm: '1507.90.11',
        cst: '000',
        cfop: '5102',
        unit: 'CX',
        quantity: 15,
        unitPrice: 110.00,
        totalPrice: 1650.00,
        declaredBatchPrice: 1650.00,
        batchSanitized: true,
        lotNumber: 'LT-SOJ-26A',
        expiryDate: '15/12/2026',
        shelfLifeDays: 35,
        fefoPriority: 'urgente',
        stackingClass: 'HEAVY_BASE',
        isCurveAPerishable: true
      },
      {
        id: 'item-2',
        code: 'ALIM-0344',
        ean13: '7891020399105',
        name: 'Arroz Parboilizado Especial 5kg - Fardo 6x5kg',
        ncm: '1006.30.21',
        cst: '000',
        cfop: '5102',
        unit: 'FD',
        quantity: 8,
        unitPrice: 155.00,
        totalPrice: 1240.00,
        lotNumber: 'LT-ARR-994',
        expiryDate: '28/05/2027',
        shelfLifeDays: 198,
        fefoPriority: 'normal',
        stackingClass: 'HEAVY_BASE',
        isCurveAPerishable: false
      },
      {
        id: 'item-3',
        code: 'PANIF-0891',
        ean13: '7891020881204',
        name: 'Biscoito Maisena Tradicional 400g - Caixa Frágil 20un',
        ncm: '1905.31.00',
        cst: '000',
        cfop: '5102',
        unit: 'CX',
        quantity: 7,
        unitPrice: 75.78,
        totalPrice: 530.50,
        lotNumber: 'LT-BIS-108',
        expiryDate: '10/03/2027',
        shelfLifeDays: 120,
        fefoPriority: 'normal',
        stackingClass: 'FRAGILE_TOP',
        isCurveAPerishable: false
      }
    ]
  },
  {
    id: 'ord-10453',
    nfe: '10453',
    accessKey: '29261012345678000190550010000104531839201922',
    customerName: 'PADARIA E DELICATESSEN DOCE PAO LTDA',
    tradeName: 'Delicatessen Doce Pão',
    cnpj: '08.392.019/0002-88',
    address: 'Av. Sete de Setembro, 3210',
    neighborhood: 'Barra',
    city: 'Salvador',
    state: 'BA',
    cep: '40130-000',
    weightKg: 180,
    volumeM3: 1.2,
    timeWindow: '08:30 - 10:30',
    status: 'em_rota',
    truckId: 'truck-01',
    lifoPosition: 2, // 2nd to unload (Zona 2 - Meio)
    fefoCompliance: 100,
    earliestExpiryDate: '18/11/2026',
    criticalItemName: 'Leite Condensado (Lote LAT-88B)',
    totalValue: 2180.00,
    icmsBase: 2180.00,
    icmsValue: 392.40,
    historicalAvgUnloadingMin: 14.0,
    completedDeliveriesCount: 4,
    items: [
      {
        id: 'item-4',
        code: 'TRIGO-0021',
        ean13: '7894900011201',
        name: 'Farinha de Trigo Especial Panificação 25kg',
        ncm: '1101.00.10',
        cst: '000',
        cfop: '5102',
        unit: 'SC',
        quantity: 6,
        unitPrice: 195.00,
        totalPrice: 1170.00,
        lotNumber: 'LT-TRG-412',
        expiryDate: '05/01/2027',
        shelfLifeDays: 85,
        fefoPriority: 'normal',
        stackingClass: 'HEAVY_BASE',
        isCurveAPerishable: false
      },
      {
        id: 'item-5',
        code: 'LATIC-0512',
        ean13: '7891000105504',
        name: 'Leite Condensado Semidesnatado TP 395g - Caixa 27un',
        ncm: '0402.99.00',
        cst: '000',
        cfop: '5102',
        unit: 'CX',
        quantity: 10,
        unitPrice: 101.00,
        totalPrice: 1010.00,
        declaredBatchPrice: 1010.00,
        batchSanitized: true,
        lotNumber: 'LT-LAT-88B',
        expiryDate: '18/11/2026',
        shelfLifeDays: 37,
        fefoPriority: 'urgente',
        stackingClass: 'FRAGILE_TOP',
        isCurveAPerishable: true
      }
    ]
  },
  {
    id: 'ord-10454',
    nfe: '10454',
    accessKey: '29261012345678000190550010000104541940294831',
    customerName: 'MERCEARIA E CEREALISTA SAO JORGE LTDA',
    tradeName: 'Mercearia São Jorge',
    cnpj: '21.094.821/0001-19',
    address: 'Av. General San Martin, 1420',
    neighborhood: 'San Martin',
    city: 'Salvador',
    state: 'BA',
    cep: '40385-001',
    weightKg: 450,
    volumeM3: 2.4,
    timeWindow: '09:00 - 11:00',
    status: 'em_rota',
    truckId: 'truck-03',
    lifoPosition: 1,
    fefoCompliance: 100,
    earliestExpiryDate: '20/01/2027',
    criticalItemName: 'Macarrão com Ovos (Lote MAS-310)',
    totalValue: 4890.00,
    icmsBase: 4890.00,
    icmsValue: 880.20,
    historicalAvgUnloadingMin: 15.0,
    completedDeliveriesCount: 2,
    items: [
      {
        id: 'item-6',
        code: 'ACUC-0112',
        ean13: '7896001201109',
        name: 'Açúcar Cristal Branco Especial 5kg - Fardo 6x5kg',
        ncm: '1701.99.00',
        cst: '000',
        cfop: '5102',
        unit: 'FD',
        quantity: 12,
        unitPrice: 125.00,
        totalPrice: 1500.00,
        lotNumber: 'LT-ACU-772',
        expiryDate: '14/09/2027',
        shelfLifeDays: 307,
        fefoPriority: 'normal',
        stackingClass: 'HEAVY_BASE',
        isCurveAPerishable: false
      },
      {
        id: 'item-7',
        code: 'MASS-0442',
        ean13: '7896005509904',
        name: 'Macarrão Espaguete com Ovos 500g - Caixa Frágil 24un',
        ncm: '1902.11.00',
        cst: '000',
        cfop: '5102',
        unit: 'CX',
        quantity: 16,
        unitPrice: 95.00,
        totalPrice: 1520.00,
        lotNumber: 'LT-MAS-310',
        expiryDate: '20/01/2027',
        shelfLifeDays: 100,
        fefoPriority: 'normal',
        stackingClass: 'FRAGILE_TOP',
        isCurveAPerishable: false
      },
      {
        id: 'item-8',
        code: 'BEB-0912',
        ean13: '7896008812308',
        name: 'Café Torrado e Moído Tradicional 250g - Caixa 20un',
        ncm: '0901.21.00',
        cst: '000',
        cfop: '5102',
        unit: 'CX',
        quantity: 11,
        unitPrice: 170.00,
        totalPrice: 1870.00,
        lotNumber: 'LT-CAF-092',
        expiryDate: '15/04/2027',
        shelfLifeDays: 185,
        fefoPriority: 'normal',
        stackingClass: 'FRAGILE_TOP',
        isCurveAPerishable: false
      }
    ]
  },
  {
    id: 'ord-10455',
    nfe: '10455',
    accessKey: '29261012345678000190550010000104551109283744',
    customerName: 'COMERCIAL DE ALIMENTOS ESPERANCA LTDA',
    tradeName: 'Atacadinho Esperança',
    cnpj: '33.910.482/0001-92',
    address: 'Av. Dorival Caymmi, 580',
    neighborhood: 'Itapuã',
    city: 'Salvador',
    state: 'BA',
    cep: '41635-150',
    weightKg: 210,
    volumeM3: 1.5,
    timeWindow: '10:30 - 12:30',
    status: 'em_rota',
    truckId: 'truck-02',
    lifoPosition: 1,
    fefoCompliance: 100,
    earliestExpiryDate: '02/12/2026',
    criticalItemName: 'Extrato de Tomate (Lote TOM-552)',
    totalValue: 2650.00,
    icmsBase: 2650.00,
    icmsValue: 477.00,
    historicalAvgUnloadingMin: 12.8,
    completedDeliveriesCount: 6,
    items: [
      {
        id: 'item-9',
        code: 'CONS-0120',
        ean13: '7891150023107',
        name: 'Extrato de Tomate Concentrado 340g - Caixa 24un',
        ncm: '2002.90.90',
        cst: '000',
        cfop: '5102',
        unit: 'CX',
        quantity: 14,
        unitPrice: 85.00,
        totalPrice: 1190.00,
        lotNumber: 'LT-TOM-552',
        expiryDate: '02/12/2026',
        shelfLifeDays: 51,
        fefoPriority: 'urgente',
        stackingClass: 'HEAVY_BASE',
        isCurveAPerishable: true
      },
      {
        id: 'item-10',
        code: 'ALIM-0761',
        ean13: '7891150099805',
        name: 'Biscoito Cream Cracker Especial 400g - Caixa 20un',
        ncm: '1905.90.20',
        cst: '000',
        cfop: '5102',
        unit: 'CX',
        quantity: 15,
        unitPrice: 97.33,
        totalPrice: 1460.00,
        lotNumber: 'LT-BIS-184',
        expiryDate: '12/03/2027',
        shelfLifeDays: 151,
        fefoPriority: 'normal',
        stackingClass: 'FRAGILE_TOP',
        isCurveAPerishable: false
      }
    ]
  }
];

export const INITIAL_VEHICLES: Vehicle[] = [
  {
    id: 'truck-01',
    name: 'Caminhão 01',
    model: 'Hyundai HR Baú Refrigerado (VUC)',
    presetType: 'VUC_HR_BONGO',
    plate: 'PKL-4A82',
    driverName: 'Carlos Santos',
    driverPhone: '(71) 99231-4482',
    maxWeightKg: 1500,
    maxVolumeM3: 8.0,
    operationalSafetyRatio: 0.90,
    currentWeightKg: 1280, // 85.3%
    currentVolumeM3: 6.8,  // 85.0%
    fuelConsumptionKmL: 8.5,
    zrtcCompliant: true,
    status: 'em_rota',
    allocatedOrders: ['ord-10452', 'ord-10453'], // ord-10452 is nearest the door (Zona 1: Rio Vermelho), ord-10453 is Zona 2 (Barra)
    routeDescription: 'Orla Marítima (Rio Vermelho → Barra)',
    currentLocation: 'Rua Oswaldo Cruz, Rio Vermelho',
    etaNextStop: '08:15'
  },
  {
    id: 'truck-02',
    name: 'Caminhão 02',
    model: 'Iveco Daily 35S14 Baú Seco (VUC)',
    presetType: 'VUC_HR_BONGO',
    plate: 'OZG-9B14',
    driverName: 'Marcos Bahia',
    driverPhone: '(71) 98844-9914',
    maxWeightKg: 1800,
    maxVolumeM3: 9.5,
    operationalSafetyRatio: 0.90,
    currentWeightKg: 1512, // 84.0%
    currentVolumeM3: 7.9,  // 83.1%
    fuelConsumptionKmL: 8.0,
    zrtcCompliant: true,
    status: 'em_rota',
    allocatedOrders: ['ord-10455'],
    routeDescription: 'Eixo Paralela → Itapuã / São Cristóvão',
    currentLocation: 'Av. Luís Viana Filho (Paralela) km 7',
    etaNextStop: '11:15'
  },
  {
    id: 'truck-03',
    name: 'Caminhão 03',
    model: 'VW Delivery 9.170 (Caminhão 3/4)',
    presetType: 'TRUCK_3_4',
    plate: 'RDN-3F21',
    driverName: 'Roberto Lima',
    driverPhone: '(71) 99182-3321',
    maxWeightKg: 3500,
    maxVolumeM3: 18.0,
    operationalSafetyRatio: 0.90,
    currentWeightKg: 2980, // 85.1%
    currentVolumeM3: 15.2, // 84.4%
    fuelConsumptionKmL: 7.5,
    zrtcCompliant: false,
    status: 'em_rota',
    allocatedOrders: ['ord-10454'],
    routeDescription: 'Miolo Urbano (San Martin → Liberdade)',
    currentLocation: 'Largo do Tanque / San Martin',
    etaNextStop: '09:40'
  }
];

export const INITIAL_DECISION_SCENARIO: DecisionScenario = {
  id: 'scen-01',
  title: 'Pedido Adicional Emergencial de Balcão',
  client: 'Mercadinho da Praça',
  neighborhood: 'Pituba (Av. Manoel Dias da Silva, 1120)',
  weightKg: 140,
  volumeM3: 0.9,
  orderValue: 1280.00,
  todayOption: {
    description: 'Requer contratação de frete avulso extra (carreto terceirizado urgente).',
    extraCost: 150.00,
    marginImpact: 'Reduz margem bruta da entrega a 0.2% (custo operacional de R$ 150 anula o lucro do pedido).',
    fleetImpact: 'Veículos 01 e 02 não possuem cubagem livre na janela solicitada de hoje sem desviar rota programada.'
  },
  tomorrowOption: {
    description: 'Encaixa na rota já programada da Pituba/Itaigara com 40% de espaço livre no Caminhão 01.',
    extraCost: 0.00,
    marginImpact: 'Margem preservada integralmente (lucro operacional líquido de R$ 242,00 · > 12% RN-14).',
    fleetImpact: 'Ocupação do baú sobe de 58% para 82% no dia de amanhã com custo marginal de combustível zero.'
  },
  verdict: {
    recommendation: 'tomorrow',
    title: 'Recomendado Consolidar Amanhã (D+1)',
    rationale: 'Alçada RN-14: Frete avulso hoje reduz margem abaixo do piso de 12%. Cliente possui estoque de segurança para 48h.',
    savings: 150.00
  },
  status: 'pending'
};

export const INITIAL_TRAFFIC_EVENTS: TrafficEvent[] = [
  {
    id: 'traf-01',
    title: 'Lentidão acentuada na Av. Paralela (sentido Centro/Aeroporto)',
    road: 'Av. Luís Viana Filho (Paralela) - Proximidades CAB / Pituaçu',
    delayMinutes: 25,
    severity: 'alta',
    impactTruckId: 'truck-02',
    impactClient: 'Atacadinho Esperança (Itapuã)',
    impactNfe: '10455',
    originalEta: '10:55',
    projectedEta: '11:15',
    whatsappMessage: {
      recipient: 'Atacadinho Esperança',
      phone: '+55 71 99876-5432',
      text: 'Olá, Atacadinho Esperança! Seu pedido #10455 da Bahia Alimentos está a caminho. Devido a uma retenção de tráfego na Av. Paralela, atualizamos sua previsão de entrega para 11:15 (ajuste de +20 min). Estamos monitorando para chegar o mais rápido possível!',
      status: 'enviada_sucesso',
      sentAt: '10:04'
    },
    alternativeRoute: {
      name: 'Desvio via Av. Pinto de Aguiar → Orla / Av. Otávio Mangabeira',
      savingsMinutes: 14,
      applied: false
    }
  },
  {
    id: 'traf-02',
    title: 'Gargalo no Bonocô (Acesso Viaduto dos Rodoviários / Av. ACM)',
    road: 'Av. Mário Leal Ferreira (Bonocô)',
    delayMinutes: 12,
    severity: 'moderada',
    impactTruckId: 'truck-03',
    impactClient: 'Mercearia São Jorge (San Martin)',
    impactNfe: '10454',
    originalEta: '09:28',
    projectedEta: '09:40',
    whatsappMessage: {
      recipient: 'Mercearia São Jorge',
      phone: '+55 71 99123-8890',
      text: 'Prezada Mercearia São Jorge: O veículo da Bahia Alimentos está a 15 min do seu estabelecimento na San Martin. Previsão ajustada para 09:40 devido à lentidão no Bonocô.',
      status: 'enviada_sucesso',
      sentAt: '09:15'
    }
  },
  {
    id: 'traf-03',
    title: 'Obras na Av. Centenário / Acesso Barra',
    road: 'Av. Centenário (trecho Chame-Chame)',
    delayMinutes: 6,
    severity: 'leve',
    impactTruckId: 'truck-01',
    impactClient: 'Delicatessen Doce Pão (Barra)',
    impactNfe: '10453',
    originalEta: '08:45',
    projectedEta: '08:51',
    whatsappMessage: {
      recipient: 'Delicatessen Doce Pão',
      phone: '+55 71 98711-2233',
      text: 'Olá Doce Pão! Pedido #10453 em trânsito com motorista Carlos. Previsão de chegada na Barra às 08:51.',
      status: 'enviada_sucesso',
      sentAt: '08:20'
    }
  }
];

export const COMPANY_INFO = {
  name: 'DISTRIBUIDORA BAHIA ALIMENTOS LTDA',
  tradeName: 'Bahia Alimentos Atacado & Distribuição',
  cnpj: '12.345.678/0001-90',
  ie: '062.839.112',
  address: 'Rodovia BR-324, Km 12 - Porto Seco Pirajá',
  city: 'Salvador',
  state: 'BA',
  cep: '41233-010',
  phone: '(71) 3390-8800'
};
