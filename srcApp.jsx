import { useState, useEffect, useRef, useCallback } from "react";

// ─── BASE ASSET DATA ────────────────────────────────────────────────────────
const BASE_ASSETS = [
  {num:"1001",plant:"01 FUEL FARM",desc:"FUEL TANKS",code:"",model:"",cap:"-",reg:"",eng:"",serial:"HE0014-TK1",loc:"FUEL FARM",status:"OPERATIONAL"},
  {num:"1002",plant:"01 FUEL FARM",desc:"FUEL PUMP HOUSE",code:"",model:"",cap:"",reg:"",eng:"",serial:"",loc:"FUEL PUMP ROOM",status:"OPERATIONAL"},
  {num:"1003",plant:"01 FUEL FARM",desc:"METERING ROOM",code:"",model:"",cap:"",reg:"",eng:"",serial:"",loc:"FUEL CNTRL ROOM",status:"OPERATIONAL"},
  {num:"2001",plant:"02 CEMENT PLANT",desc:"CEMENT STORAGE SILO",code:"",model:"",cap:"200 TONS",reg:"",eng:"",serial:"",loc:"CEMENT PLANT AREA",status:"OPERATIONAL"},
  {num:"2002",plant:"02 CEMENT PLANT",desc:"CEMENT CONVEYORS",code:"",model:"",cap:"200 KG",reg:"",eng:"",serial:"",loc:"CEMENT PLANT 01",status:"OPERATIONAL"},
  {num:"2003",plant:"02 CEMENT PLANT",desc:"CEMENT FILTER TOWERS",code:"",model:"",cap:"200 KG",reg:"",eng:"",serial:"",loc:"CEMENT PLANT 02",status:"OPERATIONAL"},
  {num:"2004",plant:"02 CEMENT PLANT",desc:"CEMENT PACKING PLANTS",code:"",model:"",cap:"200 KG",reg:"",eng:"",serial:"",loc:"CEMENT PLANT 03",status:"OPERATIONAL"},
  {num:"2005",plant:"02 CEMENT PLANT",desc:"SCREW CONVEYORS",code:"",model:"",cap:"200 KG",reg:"",eng:"",serial:"",loc:"CEMENT PLANT 01",status:"OPERATIONAL"},
  {num:"3001",plant:"03 LPG PLANT",desc:"LPG SPHERE TANKS",code:"ST - 01",model:"",cap:"800T",reg:"",eng:"",serial:"",loc:"LPG TANK AREA",status:"OPERATIONAL"},
  {num:"3002",plant:"03 LPG PLANT",desc:"LPG FILLING MACHINES",code:"",model:"",cap:"8 CYLINDER 10KG",reg:"",eng:"",serial:"",loc:"LPG PLANT BUILDING",status:"OPERATIONAL"},
  {num:"3003",plant:"03 LPG PLANT",desc:"LPG PUMP HOUSE",code:"",model:"",cap:"1 SMALL CYLINDER",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"4001",plant:"04 POWER HOUSE",desc:"GENERATOR SET-1",code:"GS 01",model:"",cap:"",reg:"",eng:"",serial:"",loc:"POWERHOUSE",status:"OPERATIONAL"},
  {num:"4002",plant:"04 POWER HOUSE",desc:"GENERATOR SET-2",code:"GS 02",model:"HIERSUN / CCFJ350J",cap:"437 KVA",reg:"",eng:"160111638",serial:"H160403-M",loc:"POWERHOUSE",status:"OPERATIONAL"},
  {num:"4003",plant:"04 POWER HOUSE",desc:"GENERATOR SET-3",code:"GS 03",model:"HIERSUN / CCFJ350J",cap:"437 KVA",reg:"",eng:"160111638",serial:"H160402-M",loc:"POWERHOUSE",status:"OPERATIONAL"},
  {num:"4004",plant:"04 POWER HOUSE",desc:"SEA WATER DESALATION UNIT",code:"SWD 01",model:"ACE / S0-K11OTR",cap:"100 CU M",reg:"",eng:"",serial:"0310-802-B",loc:"POWERHOUSE",status:"OPERATIONAL"},
  {num:"4005",plant:"04 POWER HOUSE",desc:"AIR COMPRESSOR-1",code:"AC 02",model:"ATLAS COPCO / GA30+FF A 10",cap:"9.8 BAR",reg:"",eng:"",serial:"1506842",loc:"POWERHOUSE",status:"OPERATIONAL"},
  {num:"4006",plant:"04 POWER HOUSE",desc:"AIR COMPRESSOR-2",code:"AC 03",model:"ATLAS COPCO / GA30",cap:"10 BAR",reg:"",eng:"",serial:"AII 367717",loc:"POWERHOUSE",status:"OPERATIONAL"},
  {num:"5001",plant:"05 ROOFING PLANT",desc:"COIL MACHINE",code:"CCM 01",model:"BMS",cap:"1MM - 20MM GAUGE",reg:"",eng:"",serial:"200568",loc:"ROOFING PLANT",status:"OPERATIONAL"},
  {num:"5002",plant:"05 ROOFING PLANT",desc:"COIL MACHINE",code:"CCM 02",model:"BMS",cap:"1MM - 20MM GAUGE",reg:"",eng:"",serial:"200569",loc:"ROOFING PLANT",status:"OPERATIONAL"},
  {num:"5003",plant:"05 ROOFING PLANT",desc:"CUTTER MACHINE",code:"CTM 01",model:"BMS",cap:"1MM - 20MM GAUGE",reg:"",eng:"",serial:"200572",loc:"ROOFING PLANT",status:"OPERATIONAL"},
  {num:"5004",plant:"05 ROOFING PLANT",desc:"CUTTER MACHINE MANUAL",code:"CTM 02",model:"BMS",cap:"1MM - 20MM GAUGE",reg:"",eng:"",serial:"",loc:"ROOFING PLANT",status:"OPERATIONAL"},
  {num:"5005",plant:"05 ROOFING PLANT",desc:"CUTTER AND BENDING MACHINE",code:"CBM 03",model:"BMS",cap:"1MM - 20MM GAUGE",reg:"",eng:"",serial:"200571",loc:"ROOFING PLANT",status:"OPERATIONAL"},
  {num:"5006",plant:"05 ROOFING PLANT",desc:"ROOFING MACHINE",code:"RM 01",model:"BMS",cap:"1MM - 20MM GAUGE",reg:"",eng:"",serial:"200569",loc:"ROOFING PLANT",status:"OPERATIONAL"},
  {num:"5007",plant:"05 ROOFING PLANT",desc:"ROOFING MACHINE",code:"RM 02",model:"BMS",cap:"1MM - 20MM GAUGE",reg:"",eng:"",serial:"",loc:"ROOFING PLANT",status:"OPERATIONAL"},
  {num:"5008",plant:"05 ROOFING PLANT",desc:"C & Z Purlin MACHINE",code:"ZM 31",model:"BMS",cap:"1MM - 20MM GAUGE",reg:"",eng:"",serial:"200570",loc:"ROOFING PLANT",status:"OPERATIONAL"},
  {num:"5009",plant:"05 ROOFING PLANT",desc:"AIR COMPRESSOR",code:"AC 01",model:"ATLAS COPCO / GA30+FF A 10",cap:"9.8 BAR",reg:"",eng:"",serial:"WUM346952",loc:"ROOFING PLANT",status:"OPERATIONAL"},
  {num:"6001",plant:"06 OXYGEN PLANT",desc:"PUMP BOOSTER",code:"",model:"ING.LA.BOSCHI",cap:"51KG / CM2",reg:"",eng:"",serial:"364 2PHF211",loc:"OXYGEN PLANT",status:"OPERATIONAL"},
  {num:"6002",plant:"06 OXYGEN PLANT",desc:"VERTICAL DRY PUMP EXPANDER",code:"",model:"CRYO EXPANDER",cap:"05 / CM2",reg:"",eng:"",serial:"",loc:"OXYGEN PLANT",status:"OPERATIONAL"},
  {num:"6003",plant:"06 OXYGEN PLANT",desc:"AIR SEPARATION COLUMN",code:"",model:"UBP 130",cap:"",reg:"",eng:"",serial:"UBP 130/RC/21",loc:"OXYGEN PLANT",status:"OPERATIONAL"},
  {num:"6004",plant:"06 OXYGEN PLANT",desc:"PURIFICATION UNIT",code:"",model:"UBP 130",cap:"780M3/HR",reg:"",eng:"",serial:"UBP 130/PS/21",loc:"OXYGEN PLANT",status:"OPERATIONAL"},
  {num:"6005",plant:"06 OXYGEN PLANT",desc:"LIQUID OXYGEN PUMP",code:"",model:"RECIPROCATING",cap:"5 BAR / 165 BAR",reg:"",eng:"",serial:"",loc:"OXYGEN PLANT",status:"OPERATIONAL"},
  {num:"6006",plant:"06 OXYGEN PLANT",desc:"CYLINDER PRESSURE TEST MACHINE",code:"",model:"ZL-1/22.5-III",cap:"7L/MIN.",reg:"",eng:"",serial:"075",loc:"OXYGEN PLANT",status:"OPERATIONAL"},
  {num:"6007",plant:"06 OXYGEN PLANT",desc:"REFILLING STATION",code:"",model:"",cap:"12 TANKS",reg:"",eng:"",serial:"",loc:"OXYGEN PLANT",status:"OPERATIONAL"},
  {num:"6008",plant:"06 OXYGEN PLANT",desc:"AIR COMPRESSOR",code:"AC 04",model:"ATLAS COPCO / GA75",cap:"7.5 BAR",reg:"",eng:"",serial:"",loc:"OXYGEN PLANT",status:"OPERATIONAL"},
  {num:"7001",plant:"07 MOBILE MACHINERY",desc:"MOBILE CRANE-80T",code:"MC-06",model:"SYM5460JQZ (STC800T5)",cap:"80 TONS",reg:"",eng:"ISLE375 30",serial:"SYM5460J",loc:"Q-MARINE",status:"OPERATIONAL"},
  {num:"7002",plant:"07 MOBILE MACHINERY",desc:"MOBILE CRANE-25T",code:"MC-08",model:"STC250T5",cap:"25 TONS",reg:"",eng:"93362323",serial:"SYM5333J",loc:"CEMENT PLANT",status:"OPERATIONAL"},
  {num:"7003",plant:"07 MOBILE MACHINERY",desc:"MOBILE CRANE-25T",code:"MC-09",model:"STC250T5",cap:"25 TONS",reg:"",eng:"",serial:"",loc:"",status:"NEW"},
  {num:"7004",plant:"07 MOBILE MACHINERY",desc:"MOBILE CRANE-25T",code:"MC-10",model:"STC250T5",cap:"25 TONS",reg:"",eng:"93554030",serial:"LFCNLDP5P3S2004496",loc:"",status:""},
  {num:"7005",plant:"07 MOBILE MACHINERY",desc:"MOBILE CRANE-25T",code:"MC-11",model:"STC250T5",cap:"25 TONS",reg:"",eng:"93554033",serial:"LFCNLDP5P3S2004496",loc:"",status:""},
  {num:"7006",plant:"07 MOBILE MACHINERY",desc:"FORKLIFT -5T",code:"FL 01",model:"HEC HA / FD50",cap:"5 TONS",reg:"V-3006",eng:"6BG1-385670",serial:"1905001147/1911090",loc:"GENERAL STORE",status:"OPERATIONAL"},
  {num:"7007",plant:"07 MOBILE MACHINERY",desc:"FORKLIFT- 3T TOYOTA",code:"FL 02",model:"TOYOTA / 62-7FD30",cap:"3 TONS",reg:"V-1581",eng:"1DZ-0077601",serial:"607fd30-10856",loc:"GENERAL STORE",status:"OPERATIONAL"},
  {num:"7008",plant:"07 MOBILE MACHINERY",desc:"FORKLIFT-5T",code:"FL 03",model:"KOMATSU / 6D102E-1",cap:"5 TONS",reg:"C-1207",eng:"H20-K03166Y",serial:"M151-528881",loc:"CEMENT PLANT",status:"OPERATIONAL"},
  {num:"7009",plant:"07 MOBILE MACHINERY",desc:"FORKLIFT-HECHA / 62-7FD30-3T",code:"FL 04",model:"HEC HA / 62-7FD30",cap:"3 TONS",reg:"C7A-2832",eng:"C240-258991",serial:"1703002275",loc:"CEMENT PLANT",status:"OPERATIONAL"},
  {num:"7010",plant:"07 MOBILE MACHINERY",desc:"FORKLIFT PETROL",code:"FL 05",model:"KOMATSU",cap:"3 TONS",reg:"V-1513",eng:"H20-K19766Y",serial:"M151-544254",loc:"ESD",status:"BREAKDOWN"},
  {num:"7011",plant:"07 MOBILE MACHINERY",desc:"FORKLIFT ELECTRIC DRIVE",code:"FL 06",model:"HITOP - CPD16",cap:"1.6 TONS",reg:"",eng:"",serial:"202109023",loc:"ROOFING PLANT",status:"OPERATIONAL"},
  {num:"7012",plant:"07 MOBILE MACHINERY",desc:"FORKLIFT- 5T (**597)",code:"FL 07",model:"HEC HA / FD50",cap:"5 TONS",reg:"",eng:"",serial:"",loc:"CEMENT PLANT",status:"OPERATIONAL"},
  {num:"7013",plant:"07 MOBILE MACHINERY",desc:"FORKLIFT- 5T (**598)",code:"FL 08",model:"HEC HA / FD50",cap:"5 TONS",reg:"",eng:"",serial:"",loc:"CEMENT PLANT",status:"OPERATIONAL"},
  {num:"7014",plant:"07 MOBILE MACHINERY",desc:"AIR COMPRESSOR",code:"AC 05",model:"PUMA / PP 310p",cap:"10 HP",reg:"",eng:"",serial:"",loc:"WORKSHOP",status:"OPERATIONAL"},
  {num:"7015",plant:"07 MOBILE MACHINERY",desc:"OVERHEAD CRANE",code:"OH 01",model:"ELECTROMECH",cap:"5 TONS",reg:"SR 779",eng:"",serial:"",loc:"ROOFING PLANT",status:"OPERATIONAL"},
  {num:"7016",plant:"07 MOBILE MACHINERY",desc:"OVERHEAD CRANE",code:"OH 02",model:"ELECTROMECH",cap:"5 TONS",reg:"SR 780",eng:"",serial:"",loc:"ROOFING PLANT",status:"OPERATIONAL"},
  {num:"7017",plant:"07 MOBILE MACHINERY",desc:"Schwing Stetter Stationary Pump-01",code:"SP 01",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:""},
  {num:"7018",plant:"07 MOBILE MACHINERY",desc:"Schwing Stetter Stationary Pump-02",code:"SP 02",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:""},
  {num:"7019",plant:"07 MOBILE MACHINERY",desc:"SANY Concrete Pump-1",code:"CP 01",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7020",plant:"07 MOBILE MACHINERY",desc:"Schwing Stetter Concrete Pump",code:"CP 02",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7021",plant:"07 MOBILE MACHINERY",desc:"Ashok Leyland Mixer Truck-1",code:"MT 01",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7022",plant:"07 MOBILE MACHINERY",desc:"Ashok Leyland Mixer Truck-2",code:"MT 02",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7023",plant:"07 MOBILE MACHINERY",desc:"Ashok Leyland Mixer Truck-3",code:"MT 03",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7024",plant:"07 MOBILE MACHINERY",desc:"Ashok Leyland Mixer Truck-4",code:"MT 04",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7025",plant:"07 MOBILE MACHINERY",desc:"Ashok Leyland Mixer Truck-5",code:"MT 05",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7026",plant:"07 MOBILE MACHINERY",desc:"Ashok Leyland Mixer Truck-6",code:"MT 06",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7027",plant:"07 MOBILE MACHINERY",desc:"Ashok Leyland Mixer Truck-7",code:"MT 07",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7028",plant:"07 MOBILE MACHINERY",desc:"Ashok Leyland Mixer Truck-8",code:"MT 08",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7029",plant:"07 MOBILE MACHINERY",desc:"Ashok Leyland Mixer Truck-9",code:"MT 09",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7030",plant:"07 MOBILE MACHINERY",desc:"Ashok Leyland Mixer Truck-10",code:"MT 10",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7031",plant:"07 MOBILE MACHINERY",desc:"Ashok Leyland Mixer Truck-11",code:"MT 11",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7032",plant:"07 MOBILE MACHINERY",desc:"Wheel Loader-SANY",code:"WL 01",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7033",plant:"07 MOBILE MACHINERY",desc:"Boom Lift machine",code:"BL 01",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7034",plant:"07 MOBILE MACHINERY",desc:"Excavator TATA HITACHI ZX220",code:"EX 01",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7035",plant:"07 MOBILE MACHINERY",desc:"Excavator TATA HITACHI ZX370",code:"EX 02",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"7036",plant:"07 MOBILE MACHINERY",desc:"Putzmeister Stationary Pump-3",code:"SP 03",model:"Hired",cap:"",reg:"",eng:"",serial:"",loc:"",status:""},
  {num:"7037",plant:"07 MOBILE MACHINERY",desc:"MOBILE CRANE-KATO 25T",code:"MC-09",model:"KATO/SR-250Ri",cap:"25 TONS",reg:"",eng:"-",serial:"6711112",loc:"THILAFUSHI",status:"OPERATIONAL"},
  {num:"7038",plant:"07 MOBILE MACHINERY",desc:"FORKLIFT 3T KOMATSU",code:"FL 09",model:"KOMATSU",cap:"03 TON",reg:"",eng:"-",serial:"-",loc:"CEMENT PLANT",status:"OPERATIONAL"},
  {num:"7039",plant:"07 MOBILE MACHINERY",desc:"NISSAN Mixer Truck-1",code:"MT 12",model:"NISSAN",cap:"6 Cum",reg:"",eng:"-",serial:"CW520HN-08909",loc:"SUN ISLAND",status:"Inactive"},
  {num:"7040",plant:"07 MOBILE MACHINERY",desc:"NISSAN Mixer Truck-2",code:"MT 13",model:"NISSAN",cap:"6 Cum",reg:"",eng:"-",serial:"",loc:"SUN ISLAND",status:"Inactive"},
  {num:"7041",plant:"07 MOBILE MACHINERY",desc:"SENNEBOGEN Material handler",code:"MH-1",model:"Sennebogen",cap:"15T",reg:"",eng:"22590596",serial:"835.0.4099",loc:"THILAFUSHI",status:"OPERATIONAL"},
  {num:"7042",plant:"07 MOBILE MACHINERY",desc:"SANY Concrete Pump-2",code:"CP-02",model:"SANY",cap:"160m3/H",reg:"",eng:"DL121113473",serial:"BC5310CF2233",loc:"THILAFUSHI",status:"OPERATIONAL"},
  {num:"7043",plant:"07 MOBILE MACHINERY",desc:"Wheel Loader-Liu Gong",code:"WL 02",model:"Liu Gong",cap:"160m3/H",reg:"",eng:"",serial:"",loc:"THILAFUSHI",status:"OPERATIONAL"},
  {num:"8001",plant:"08 VEHICLES",desc:"BOOMTRUCK LORRY-C1336",code:"BT 01",model:"HINO",cap:"9.2 TONS",reg:"C-1336",eng:"RG8-125503",serial:"CY53YP-00003",loc:"Batching Plant",status:"OPERATIONAL"},
  {num:"8002",plant:"08 VEHICLES",desc:"BOOMTRUCK XDR-2095",code:"BT 02",model:"XDR / YZR5082JSQL",cap:"8.950 TONS",reg:"C C0A C2095",eng:"YC4FA120-33",serial:"LGDGH91G6KH135686",loc:"CEMENT PLANT",status:"OPERATIONAL"},
  {num:"8003",plant:"08 VEHICLES",desc:"BOOMTRUCK XDR-C2094",code:"BT 03",model:"XDR / YC4FA120-33",cap:"8.950 TONS",reg:"C2094",eng:"GB17691-2005",serial:"LGDCH91G7KH135678",loc:"Batching Plant",status:"OPERATIONAL"},
  {num:"8004",plant:"08 VEHICLES",desc:"TRUCK LORRY",code:"BT 04",model:"H6E4ED132E/23",cap:"",reg:"",eng:"PDEZ423999",serial:"F7533513CR / PDRF254243",loc:"CEMENT PLANT",status:"OPERATIONAL"},
  {num:"8005",plant:"08 VEHICLES",desc:"TRUCK LORRY 2484",code:"BT 05",model:"H6E4ED132E/23",cap:"",reg:"",eng:"PDEZ423992",serial:"F7533413CL / PDRF255639",loc:"CEMENT PLANT",status:"OPERATIONAL"},
  {num:"8006",plant:"08 VEHICLES",desc:"TRUCK LORRY-2479",code:"BT 06",model:"H6E4ED132",cap:"",reg:"",eng:"SREZ400756",serial:"MB1DTHHD6SERR8104",loc:"CEMENT PLANT",status:"OPERATIONAL"},
  {num:"8007",plant:"08 VEHICLES",desc:"SERVICE VEHICLE PICK UP",code:"SV 01",model:"MITUSUBISHI",cap:"",reg:"COA1161",eng:"4D34-J67140",serial:"FE659F-A44479",loc:"CEMENT PLANT",status:"OPERATIONAL"},
  {num:"8008",plant:"08 VEHICLES",desc:"SERVICE VEHICLE PICK UP-Stores",code:"SV 02",model:"MITUSUBISHI",cap:"",reg:"C2A1591",eng:"4D34-K04355",serial:"FE73PEA00015",loc:"GENERAL STORE",status:"OPERATIONAL"},
  {num:"8009",plant:"08 VEHICLES",desc:"SERVICE VEHICLE PICK UP",code:"SV 03",model:"MITUSUBISHI / FB511B8",cap:"",reg:"C1276",eng:"4D40-DA7712",serial:"FB511BA44559",loc:"F&B",status:"OPERATIONAL"},
  {num:"8010",plant:"08 VEHICLES",desc:"SERVICE VEHICLE PICK UP",code:"SV 04",model:"KIA / HDH268852",cap:"1.5 TONS",reg:"CC1AC4969",eng:"KNCSH76L2",serial:"KNCSHX76LL7442309",loc:"VILLA MART",status:"OPERATIONAL"},
  {num:"8011",plant:"08 VEHICLES",desc:"SERVICE VEHICLE PICK UP-LPG",code:"SV 05",model:"HINO / XZU600R-HKTQLT3",cap:"",reg:"COA 2006",eng:"N04C-VBH16767",serial:"MNKACL1H00200290",loc:"LPG PLANT",status:"OPERATIONAL"},
  {num:"8012",plant:"08 VEHICLES",desc:"SERVICE VEHICLE VAN",code:"SV 07",model:"NISSAN / DBG4RPAE25EDZ-A",cap:"1.25 tons",reg:"AB 1A C-7069",eng:"",serial:"CWGE25-13574",loc:"ADMIN OFFICE",status:"OPERATIONAL"},
  {num:"8013",plant:"08 VEHICLES",desc:"Dump Truck-1 (***RNT7846)",code:"DT 01",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"8014",plant:"08 VEHICLES",desc:"Dump Truck-2 (416330)",code:"DT 02",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"8015",plant:"08 VEHICLES",desc:"Dump Truck-3 (400763)",code:"DT 03",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"8016",plant:"08 VEHICLES",desc:"Dump Truck-4",code:"DT 04",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"8017",plant:"08 VEHICLES",desc:"Mini Dumper-1",code:"MD 01",model:"",cap:"",reg:"",eng:"",serial:"",loc:"Thilafushi",status:"OPERATIONAL"},
  {num:"8018",plant:"08 VEHICLES",desc:"Mini Dumper-2",code:"MD 01",model:"",cap:"",reg:"",eng:"",serial:"",loc:"Fun Island",status:"OPERATIONAL"},
  {num:"9001",plant:"09 Fire Pump System",desc:"Fire Pump-1",code:"WP 01",model:"8210SR126 03",cap:"",reg:"",eng:"8210 SRI 2701A 559",serial:"",loc:"Wtr Pump Room",status:"OPERATIONAL"},
  {num:"9002",plant:"09 Fire Pump System",desc:"Fire Pump-2",code:"WP 02",model:"8210SR127 01",cap:"",reg:"",eng:"",serial:"5005",loc:"Wtr Pump Room",status:"OPERATIONAL"},
  {num:"9003",plant:"09 Fire Pump System",desc:"FIRELINE SYSTEM IN LPG PLANT",code:"",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"idle"},
  {num:"9004",plant:"09 Fire Pump System",desc:"FIRELINE SYSTEM IN FUEL FARM",code:"",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"idle"},
  {num:"10001",plant:"10 Batching Plant",desc:"Batching Plant-Thilafushi",code:"",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"10002",plant:"10 Batching Plant",desc:"Batching Plant-MAXX ROYAL",code:"",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
  {num:"10003",plant:"10 Batching Plant",desc:"Batching Plant Genset-1",code:"",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"BREAKDOWN"},
  {num:"10004",plant:"10 Batching Plant",desc:"Batching Plant Genset-2",code:"",model:"",cap:"",reg:"",eng:"",serial:"",loc:"",status:"OPERATIONAL"},
];

const STORE_KEY = 'cmms_vg_state';
const PER_PAGE = 20;
const PLANTS = ['01 FUEL FARM','02 CEMENT PLANT','03 LPG PLANT','04 POWER HOUSE','05 ROOFING PLANT','06 OXYGEN PLANT','07 MOBILE MACHINERY','08 VEHICLES','09 Fire Pump System','10 Batching Plant'];

// ─── STATUS HELPERS ─────────────────────────────────────────────────────────
function statusCls(s) {
  if (!s) return 'si';
  switch(s.toUpperCase()) {
    case 'OPERATIONAL': return 'so';
    case 'BREAKDOWN': return 'sb';
    case 'UNDER MAINTENANCE': return 'sm';
    case 'NEW': return 'sn';
    case 'IDLE': return 'sl';
    default: return 'si';
  }
}
function joStatusCls(s) {
  if (s==='OPEN') return 'jop';
  if (s==='IN PROGRESS') return 'jip';
  if (s==='CLOSED') return 'jcl';
  return '';
}

// ─── STYLES ─────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Source+Code+Pro:wght@400;600&family=Noto+Sans:wght@300;400;500;600&display=swap');
:root{
  --navy:#0a1628;--navy2:#0f2044;--steel:#1e3a6e;
  --blue:#1a56db;--accent:#f59e0b;--accent2:#fbbf24;
  --green:#10b981;--red:#ef4444;--yellow:#f59e0b;--orange:#f97316;
  --gray:#94a3b8;--light:#e2e8f0;--white:#f8fafc;
  --panel:rgba(15,32,68,0.85);--border:rgba(255,255,255,0.07);
  --fh:'Rajdhani',sans-serif;--fb:'Noto Sans',sans-serif;--fm:'Source Code Pro',monospace;
}
*{margin:0;padding:0;box-sizing:border-box;}
body,#root{background:var(--navy);color:var(--white);font-family:var(--fb);font-size:14px;min-height:100vh;}
.app{background:var(--navy);min-height:100vh;background-image:radial-gradient(ellipse at 20% 20%,rgba(26,86,219,.12) 0%,transparent 60%),radial-gradient(ellipse at 80% 80%,rgba(245,158,11,.06) 0%,transparent 60%);}
.topbar{background:var(--navy2);border-bottom:2px solid var(--accent);padding:0 28px;height:58px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;box-shadow:0 2px 24px rgba(0,0,0,.5);}
.logo{display:flex;align-items:center;gap:12px;}
.logo-icon{width:36px;height:36px;background:linear-gradient(135deg,var(--accent),var(--blue));border-radius:6px;display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:700;font-size:16px;color:var(--navy);}
.logo-text{font-family:var(--fh);font-size:20px;font-weight:700;letter-spacing:1.5px;}
.logo-sub{font-size:10px;color:var(--accent);font-family:var(--fm);letter-spacing:2px;}
.topbar-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.badge{font-family:var(--fm);font-size:11px;color:var(--accent);background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);padding:3px 10px;border-radius:3px;white-space:nowrap;}
.sync-badge{font-family:var(--fm);font-size:11px;padding:3px 10px;border-radius:3px;white-space:nowrap;}
.sync-ok{background:rgba(16,185,129,.15);color:var(--green);border:1px solid rgba(16,185,129,.3);}
.sync-saving{background:rgba(26,86,219,.15);color:#60a5fa;border:1px solid rgba(26,86,219,.3);}
.sync-loading{background:rgba(245,158,11,.1);color:var(--accent);border:1px solid rgba(245,158,11,.3);}
.layout{display:flex;min-height:calc(100vh - 58px);}
.sidebar{width:210px;flex-shrink:0;background:var(--navy2);border-right:1px solid var(--border);padding:20px 0;overflow-y:auto;}
.nav-section{padding:8px 16px 4px;font-family:var(--fm);font-size:9px;letter-spacing:2px;color:var(--gray);text-transform:uppercase;}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 20px;cursor:pointer;font-family:var(--fh);font-size:15px;font-weight:500;letter-spacing:.5px;color:var(--gray);transition:all .15s;border-left:3px solid transparent;}
.nav-item:hover{background:rgba(255,255,255,.04);color:var(--white);}
.nav-item.active{background:rgba(26,86,219,.15);color:var(--accent);border-left-color:var(--accent);}
.nav-icon{font-size:16px;width:18px;text-align:center;}
.main{flex:1;padding:28px 32px;min-height:calc(100vh - 58px);overflow:hidden;}
.page-title{font-family:var(--fh);font-size:28px;font-weight:700;letter-spacing:1px;}
.page-title span{color:var(--accent);}
.page-sub{font-size:12px;color:var(--gray);font-family:var(--fm);letter-spacing:1px;margin-top:2px;}
.page-header{margin-bottom:24px;}
.stats-row{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin-bottom:28px;}
.stat-card{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:18px 20px;backdrop-filter:blur(8px);position:relative;overflow:hidden;}
.stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;}
.sc-blue::before{background:var(--blue);}.sc-green::before{background:var(--green);}
.sc-yellow::before{background:var(--yellow);}.sc-red::before{background:var(--red);}.sc-orange::before{background:var(--orange);}
.stat-num{font-family:var(--fh);font-size:36px;font-weight:700;line-height:1;}
.sc-blue .stat-num{color:var(--blue);}.sc-green .stat-num{color:var(--green);}
.sc-yellow .stat-num{color:var(--yellow);}.sc-red .stat-num{color:var(--red);}.sc-orange .stat-num{color:var(--orange);}
.stat-label{font-size:11px;color:var(--gray);font-family:var(--fm);letter-spacing:1px;margin-top:4px;text-transform:uppercase;}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:8px;overflow:hidden;backdrop-filter:blur(6px);margin-bottom:20px;}
.panel-head{padding:14px 20px;background:rgba(255,255,255,.03);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;}
.panel-title{font-family:var(--fh);font-size:16px;font-weight:600;letter-spacing:.5px;}
.panel-body{padding:20px;}
.controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
input[type=text],input[type=date],input[type=number],select,textarea{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:var(--white);font-family:var(--fb);font-size:13px;padding:7px 12px;border-radius:5px;outline:none;transition:border-color .15s;}
input:focus,select:focus,textarea:focus{border-color:var(--blue);}
select option{background:var(--navy2);}
textarea{resize:vertical;min-height:70px;width:100%;}
.search-box{padding:7px 12px;border-radius:5px;min-width:220px;}
.btn{padding:7px 16px;border:none;border-radius:5px;cursor:pointer;font-family:var(--fh);font-size:14px;font-weight:600;letter-spacing:.5px;transition:all .15s;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;}
.btn-primary{background:var(--blue);color:#fff;}.btn-primary:hover{background:#1545b8;}
.btn-accent{background:var(--accent);color:var(--navy);}.btn-accent:hover{background:var(--accent2);}
.btn-success{background:var(--green);color:#fff;}.btn-success:hover{background:#059669;}
.btn-danger{background:var(--red);color:#fff;}.btn-danger:hover{background:#dc2626;}
.btn-warning{background:var(--orange);color:#fff;}.btn-warning:hover{background:#ea580c;}
.btn-ghost{background:rgba(255,255,255,.07);color:var(--white);border:1px solid var(--border);}.btn-ghost:hover{background:rgba(255,255,255,.12);}
.btn-sm{padding:4px 10px;font-size:12px;}
.tbl-wrap{overflow-x:auto;}
table{width:100%;border-collapse:collapse;font-size:13px;}
th{padding:9px 12px;text-align:left;font-family:var(--fh);font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--accent);background:rgba(245,158,11,.06);border-bottom:1px solid var(--border);white-space:nowrap;}
td{padding:9px 12px;border-bottom:1px solid var(--border);vertical-align:middle;}
tr:last-child td{border-bottom:none;}tr:hover td{background:rgba(255,255,255,.02);}
.sb-base{display:inline-block;padding:2px 9px;border-radius:3px;font-family:var(--fm);font-size:10px;letter-spacing:1px;font-weight:600;}
.so{background:rgba(16,185,129,.15);color:var(--green);border:1px solid rgba(16,185,129,.3);}
.sb{background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.3);}
.sm{background:rgba(249,115,22,.15);color:var(--orange);border:1px solid rgba(249,115,22,.3);}
.si{background:rgba(148,163,184,.15);color:var(--gray);border:1px solid rgba(148,163,184,.2);}
.sn{background:rgba(26,86,219,.15);color:#60a5fa;border:1px solid rgba(26,86,219,.3);}
.sl{background:rgba(245,158,11,.15);color:var(--yellow);border:1px solid rgba(245,158,11,.3);}
.jop{background:rgba(245,158,11,.15);color:var(--yellow);border:1px solid rgba(245,158,11,.3);}
.jcl{background:rgba(16,185,129,.15);color:var(--green);border:1px solid rgba(16,185,129,.3);}
.jip{background:rgba(26,86,219,.15);color:#60a5fa;border:1px solid rgba(26,86,219,.3);}
.prio-high{color:var(--red);font-weight:600;font-family:var(--fm);font-size:11px;}
.prio-low{color:var(--green);font-family:var(--fm);font-size:11px;}
.modal-overlay{display:flex;position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(3px);z-index:200;align-items:center;justify-content:center;}
.modal{background:var(--navy2);border:1px solid var(--border);border-radius:10px;width:820px;max-width:96vw;max-height:92vh;overflow-y:auto;box-shadow:0 20px 80px rgba(0,0,0,.7);}
.modal-head{padding:18px 24px;background:var(--navy2);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:5;}
.modal-title{font-family:var(--fh);font-size:20px;font-weight:700;}
.modal-close{background:none;border:none;color:var(--gray);cursor:pointer;font-size:22px;line-height:1;padding:2px 6px;}
.modal-close:hover{color:var(--white);}
.modal-body{padding:24px;}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;}
.form-row.three{grid-template-columns:1fr 1fr 1fr;}.form-row.single{grid-template-columns:1fr;}
.form-group label{display:block;font-size:11px;font-family:var(--fm);letter-spacing:1px;color:var(--gray);margin-bottom:5px;text-transform:uppercase;}
.form-group input,.form-group select,.form-group textarea{width:100%;}
.jc-section{border:1px solid var(--border);border-radius:6px;padding:14px 16px;margin-bottom:14px;}
.jc-section-title{font-family:var(--fh);font-size:13px;font-weight:600;letter-spacing:1px;color:var(--accent);text-transform:uppercase;margin-bottom:12px;display:flex;align-items:center;gap:8px;}
.jc-section-title::after{content:'';flex:1;height:1px;background:var(--border);}
.parts-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;}
.parts-table th{padding:6px 8px;background:rgba(245,158,11,.08);border:1px solid var(--border);font-family:var(--fm);font-size:10px;letter-spacing:1px;color:var(--accent);}
.parts-table td{padding:4px 6px;border:1px solid var(--border);}
.parts-table input{background:transparent;border:none;color:var(--white);font-size:12px;width:100%;padding:2px 4px;outline:none;}
.parts-table input:focus{background:rgba(255,255,255,.05);border-radius:3px;}
.checkbox-row{display:flex;gap:20px;align-items:center;flex-wrap:wrap;}
.checkbox-item{display:flex;align-items:center;gap:6px;cursor:pointer;}
.checkbox-item input[type=radio],.checkbox-item input[type=checkbox]{accent-color:var(--accent);width:14px;height:14px;}
.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.detail-item label{font-size:10px;font-family:var(--fm);color:var(--gray);letter-spacing:1px;text-transform:uppercase;display:block;margin-bottom:3px;}
.detail-item .val{font-size:14px;font-weight:500;}
.pagination{display:flex;gap:6px;align-items:center;justify-content:flex-end;padding-top:14px;}
.page-btn{padding:5px 11px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--gray);cursor:pointer;font-size:12px;}
.page-btn:hover,.page-btn.active{background:var(--blue);color:#fff;border-color:var(--blue);}
.page-info-txt{font-size:12px;color:var(--gray);font-family:var(--fm);}
.dash-grid{display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-top:20px;}
.jo-item{background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:6px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.jo-num{font-family:var(--fm);font-size:12px;color:var(--accent);}
.jo-desc{font-size:13px;}.jo-meta{font-size:11px;color:var(--gray);margin-top:2px;}
.plant-pill{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:5px;font-size:13px;margin-bottom:6px;}
.pill-count{font-family:var(--fm);color:var(--accent);font-size:13px;}
.empty-state{text-align:center;padding:40px;color:var(--gray);}
.edit-mode-banner{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4);border-radius:6px;padding:8px 14px;margin-bottom:14px;font-size:12px;color:var(--accent);font-family:var(--fm);display:flex;align-items:center;gap:8px;}
.toast-wrap{position:fixed;bottom:28px;right:28px;z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:flex-end;}
.toast-msg{background:var(--navy2);border:1px solid var(--green);border-left:4px solid var(--green);border-radius:8px;padding:12px 18px;font-size:13px;color:var(--white);box-shadow:0 8px 30px rgba(0,0,0,.4);max-width:320px;}
.toast-msg.err{border-color:var(--red);border-left-color:var(--red);}
select.sb-base{cursor:pointer;-webkit-appearance:none;appearance:none;padding:2px 8px;}
@media(max-width:900px){.sidebar{display:none;}.main{padding:16px;}.stats-row{grid-template-columns:1fr 1fr;}.dash-grid{grid-template-columns:1fr;}}
`;

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState('dashboard');
  const [assets, setAssets] = useState(() => JSON.parse(JSON.stringify(BASE_ASSETS)));
  const [jobOrders, setJobOrders] = useState([]);
  const [joCounter, setJoCounter] = useState(1000);
  const [syncStatus, setSyncStatus] = useState('loading'); // loading | saving | ok
  const [toasts, setToasts] = useState([]);
  const [clock, setClock] = useState('');
  const saveTimer = useRef(null);
  const isLoaded = useRef(false);

  // modals
  const [assetModal, setAssetModal] = useState(null); // null | {mode:'view'|'edit'|'add', asset}
  const [joModal, setJoModal] = useState(null);       // null | {mode:'view'|'edit'|'add', jo}
  const [joViewModal, setJoViewModal] = useState(null);

  // ── Clock
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'}));
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, []);

  // ── Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.assets)    setAssets(d.assets);
        if (d.jobOrders) setJobOrders(d.jobOrders);
        if (d.joCounter) setJoCounter(d.joCounter);
      }
    } catch(e) { /* no saved data yet */ }
    isLoaded.current = true;
    setSyncStatus('ok');
  }, []);

  // ── Persist (debounced) to localStorage
  const persist = useCallback((newAssets, newJOs, newCounter) => {
    if (!isLoaded.current) return;
    clearTimeout(saveTimer.current);
    setSyncStatus('saving');
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          assets: newAssets, jobOrders: newJOs, joCounter: newCounter
        }));
        setSyncStatus('ok');
        addToast('✓ Saved locally');
      } catch(e) {
        setSyncStatus('ok');
        addToast('⚠ Could not save', true);
      }
    }, 800);
  }, []);

  // ── Toast
  function addToast(msg, err=false) {
    const id = Date.now();
    setToasts(t => [...t, {id, msg, err}]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }

  // ── Asset mutations
  function updateAssetStatus(num, status) {
    setAssets(prev => {
      const next = prev.map(a => a.num===num ? {...a, status} : a);
      persist(next, jobOrders, joCounter);
      return next;
    });
    addToast(`Asset ${num} → ${status}`);
  }

  function saveAsset(asset, editNum) {
    setAssets(prev => {
      let next;
      if (editNum) {
        next = prev.map(a => a.num===editNum ? asset : a);
        addToast(`Asset ${asset.num} updated.`);
      } else {
        if (prev.find(a => a.num===asset.num)) { addToast(`Asset ${asset.num} already exists.`, true); return prev; }
        next = [...prev, asset];
        addToast(`Asset ${asset.num} added.`);
      }
      persist(next, jobOrders, joCounter);
      return next;
    });
    setAssetModal(null);
  }

  // ── JO mutations
  function saveJO(jo, editJobNo) {
    let nextJOs, nextCounter = joCounter;
    if (editJobNo) {
      nextJOs = jobOrders.map(j => j.jobNo===editJobNo ? jo : j);
      addToast(`Job Order ${editJobNo} updated.`);
    } else {
      nextCounter = joCounter + 1;
      setJoCounter(nextCounter);
      jo = {...jo, jobNo: `JO-${nextCounter}`};
      nextJOs = [...jobOrders, jo];
      addToast(`Job Order ${jo.jobNo} saved.`);
    }
    setJobOrders(nextJOs);
    persist(assets, nextJOs, nextCounter);
    setJoModal(null);
  }

  function updateJOStatus(jobNo, status) {
    setJobOrders(prev => {
      const next = prev.map(j => j.jobNo===jobNo ? {...j, status} : j);
      persist(assets, next, joCounter);
      return next;
    });
    addToast(`${jobNo} → ${status}`);
  }

  const syncLabel = syncStatus==='loading' ? '⟳ Loading...' : syncStatus==='saving' ? '💾 Saving...' : '✓ Saved';
  const syncCls   = syncStatus==='loading' ? 'sync-loading' : syncStatus==='saving' ? 'sync-saving' : 'sync-ok';

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        {/* TOPBAR */}
        <div className="topbar">
          <div className="logo">
            <div className="logo-icon">VG</div>
            <div>
              <div className="logo-text">VILLA GROUP</div>
              <div className="logo-sub">CMMS — ENGINEERING SOLUTIONS DEPT</div>
            </div>
          </div>
          <div className="topbar-right">
            <div className={`sync-badge ${syncCls}`}>{syncLabel}</div>
            <div className="badge">{clock}</div>
            <div className="badge">MALE', MALDIVES</div>
          </div>
        </div>

        <div className="layout">
          {/* SIDEBAR */}
          <div className="sidebar">
            <div className="nav-section">Main</div>
            <NavItem active={page==='dashboard'} onClick={()=>setPage('dashboard')} icon="⬡" label="Dashboard"/>
            <div className="nav-section">Assets</div>
            <NavItem active={page==='assets'} onClick={()=>setPage('assets')} icon="⚙" label="Asset Registry"/>
            <NavItem active={false} onClick={()=>setAssetModal({mode:'add'})} icon="＋" label="Add Asset"/>
            <div className="nav-section">Maintenance</div>
            <NavItem active={page==='joborders'} onClick={()=>setPage('joborders')} icon="📋" label="Job Orders"/>
            <NavItem active={false} onClick={()=>setJoModal({mode:'add'})} icon="✏" label="Raise Job Order"/>
            <div className="nav-section">Reports</div>
            <NavItem active={page==='reports'} onClick={()=>setPage('reports')} icon="📊" label="Reports"/>
          </div>

          <div className="main">
            {page==='dashboard' && <DashboardPage assets={assets} jobOrders={jobOrders} setPage={setPage} setJoModal={setJoModal}/>}
            {page==='assets'    && <AssetsPage assets={assets} setAssetModal={setAssetModal} setJoModal={setJoModal} onStatusChange={updateAssetStatus}/>}
            {page==='joborders' && <JobOrdersPage assets={assets} jobOrders={jobOrders} setJoModal={setJoModal} setJoViewModal={setJoViewModal} onStatusChange={updateJOStatus}/>}
            {page==='reports'   && <ReportsPage assets={assets} jobOrders={jobOrders}/>}
          </div>
        </div>

        {/* MODALS */}
        {assetModal && (
          assetModal.mode==='view'
            ? <AssetViewModal asset={assetModal.asset} assets={assets} jobOrders={jobOrders}
                onClose={()=>setAssetModal(null)}
                onEdit={a=>setAssetModal({mode:'edit',asset:a})}
                onJO={a=>{setAssetModal(null);setJoModal({mode:'add',preAsset:a.num});}} />
            : <AssetFormModal mode={assetModal.mode} asset={assetModal.asset}
                assets={assets} onClose={()=>setAssetModal(null)} onSave={saveAsset}/>
        )}
        {joModal && (
          <JOFormModal mode={joModal.mode} jo={joModal.jo} preAsset={joModal.preAsset}
            assets={assets} joCounter={joCounter}
            onClose={()=>setJoModal(null)} onSave={saveJO}/>
        )}
        {joViewModal && (
          <JOViewModal jo={joViewModal}
            onClose={()=>setJoViewModal(null)}
            onEdit={jo=>{setJoViewModal(null);setJoModal({mode:'edit',jo});}}/>
        )}

        {/* TOASTS */}
        <div className="toast-wrap">
          {toasts.map(t => <div key={t.id} className={`toast-msg${t.err?' err':''}`}>{t.msg}</div>)}
        </div>
      </div>
    </>
  );
}

function NavItem({active,onClick,icon,label}) {
  return <div className={`nav-item${active?' active':''}`} onClick={onClick}><span className="nav-icon">{icon}</span>{label}</div>;
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function DashboardPage({assets, jobOrders, setPage, setJoModal}) {
  const plants = {};
  assets.forEach(a => { plants[a.plant] = (plants[a.plant]||0)+1; });
  const recent = [...jobOrders].reverse().slice(0,5);
  return (
    <div>
      <div className="page-header">
        <div className="page-title">SYSTEM <span>DASHBOARD</span></div>
        <div className="page-sub">COMPUTERIZED MAINTENANCE MANAGEMENT SYSTEM // VILLA GROUP ESD</div>
      </div>
      <div className="stats-row">
        <div className="stat-card sc-blue"><div className="stat-num">{assets.length}</div><div className="stat-label">Total Assets</div></div>
        <div className="stat-card sc-green"><div className="stat-num">{assets.filter(a=>a.status==='OPERATIONAL').length}</div><div className="stat-label">Operational</div></div>
        <div className="stat-card sc-red"><div className="stat-num">{assets.filter(a=>a.status==='BREAKDOWN').length}</div><div className="stat-label">Breakdown</div></div>
        <div className="stat-card sc-orange"><div className="stat-num">{assets.filter(a=>a.status==='UNDER MAINTENANCE').length}</div><div className="stat-label">Under Maintenance</div></div>
        <div className="stat-card sc-yellow"><div className="stat-num">{jobOrders.filter(j=>j.status!=='CLOSED').length}</div><div className="stat-label">Open Job Orders</div></div>
      </div>
      <div className="dash-grid">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Recent Job Orders</div>
            <button className="btn btn-accent btn-sm" onClick={()=>setPage('joborders')}>View All</button>
          </div>
          <div className="panel-body">
            {recent.length ? recent.map(jo=>(
              <div key={jo.jobNo} className="jo-item">
                <div><div className="jo-num">{jo.jobNo}</div><div className="jo-desc">{(jo.problem||'').substring(0,55)||jo.assetDesc||'—'}</div><div className="jo-meta">{jo.assetNum} · {jo.date}</div></div>
                <span className={`sb-base ${joStatusCls(jo.status)}`}>{jo.status}</span>
              </div>
            )) : <div className="empty-state"><div>📋</div><div>No job orders yet</div></div>}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><div className="panel-title">Assets by Plant</div></div>
          <div className="panel-body">
            {Object.entries(plants).map(([p,c])=>(
              <div key={p} className="plant-pill"><span>{p}</span><span className="pill-count">{c}</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ASSETS PAGE ─────────────────────────────────────────────────────────────
function AssetsPage({assets, setAssetModal, setJoModal, onStatusChange}) {
  const [q, setQ] = useState('');
  const [plant, setPlant] = useState('');
  const [status, setStatus] = useState('');
  const [pg, setPg] = useState(1);

  const filtered = assets.filter(a => {
    const hay = [a.num,a.plant,a.desc,a.code,a.model,a.loc,a.serial].join(' ').toLowerCase();
    return (!q||hay.includes(q.toLowerCase())) && (!plant||a.plant===plant) && (!status||a.status===status);
  });
  const total = Math.ceil(filtered.length/PER_PAGE);
  const slice = filtered.slice((pg-1)*PER_PAGE, pg*PER_PAGE);

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
        <div>
          <div className="page-title">ASSET <span>REGISTRY</span></div>
          <div className="page-sub">{assets.length} ASSETS ACROSS {[...new Set(assets.map(a=>a.plant))].length} PLANTS</div>
        </div>
        <div className="controls">
          <input className="search-box" value={q} onChange={e=>{setQ(e.target.value);setPg(1);}} placeholder="🔍 Search assets..."/>
          <select value={plant} onChange={e=>{setPlant(e.target.value);setPg(1);}}>
            <option value="">All Plants</option>
            {[...new Set(assets.map(a=>a.plant))].map(p=><option key={p}>{p}</option>)}
          </select>
          <select value={status} onChange={e=>{setStatus(e.target.value);setPg(1);}}>
            <option value="">All Status</option>
            {['OPERATIONAL','BREAKDOWN','UNDER MAINTENANCE','NEW','Inactive','idle'].map(s=><option key={s}>{s}</option>)}
          </select>
          <button className="btn btn-accent" onClick={()=>setAssetModal({mode:'add'})}>＋ Add Asset</button>
        </div>
      </div>
      <div className="panel">
        <div className="tbl-wrap">
          <table>
            <thead><tr>
              <th>Asset No.</th><th>Plant</th><th>Description</th><th>Eq. Code</th>
              <th>Model/Make</th><th>Capacity</th><th>Location</th><th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {slice.map(a=>(
                <tr key={a.num}>
                  <td style={{fontFamily:'var(--fm)',fontSize:12,color:'var(--accent)'}}>{a.num}</td>
                  <td style={{fontSize:12}}>{a.plant}</td>
                  <td><strong>{a.desc}</strong></td>
                  <td style={{fontFamily:'var(--fm)',fontSize:11}}>{a.code||'—'}</td>
                  <td style={{fontSize:12}}>{a.model||'—'}</td>
                  <td style={{fontSize:12}}>{a.cap||'—'}</td>
                  <td style={{fontSize:12}}>{a.loc||'—'}</td>
                  <td>
                    <select className={`sb-base ${statusCls(a.status)}`} value={a.status||''} onChange={e=>onStatusChange(a.num,e.target.value)}>
                      {['OPERATIONAL','BREAKDOWN','UNDER MAINTENANCE','NEW','Inactive','idle'].map(s=><option key={s} value={s}>{s==='UNDER MAINTENANCE'?'UNDER MAINT.':s.toUpperCase()}</option>)}
                    </select>
                  </td>
                  <td>
                    <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                      <button className="btn btn-ghost btn-sm" onClick={()=>setAssetModal({mode:'view',asset:a})}>View</button>
                      <button className="btn btn-warning btn-sm" onClick={()=>setAssetModal({mode:'edit',asset:a})}>✏ Edit</button>
                      <button className="btn btn-primary btn-sm" onClick={()=>setJoModal({mode:'add',preAsset:a.num})}>+ JO</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',borderTop:'1px solid var(--border)'}}>
          <div className="page-info-txt">Showing {Math.min((pg-1)*PER_PAGE+1,filtered.length)}–{Math.min(pg*PER_PAGE,filtered.length)} of {filtered.length} assets</div>
          <div className="pagination">
            {pg>1&&<button className="page-btn" onClick={()=>setPg(pg-1)}>‹</button>}
            {Array.from({length:total},(_,i)=>i+1).filter(i=>i===1||i===total||(i>=pg-1&&i<=pg+1)).map((i,idx,arr)=>[
              idx>0&&arr[idx-1]!==i-1?<span key={`e${i}`} style={{color:'var(--gray)',padding:'0 4px'}}>…</span>:null,
              <button key={i} className={`page-btn${i===pg?' active':''}`} onClick={()=>setPg(i)}>{i}</button>
            ])}
            {pg<total&&<button className="page-btn" onClick={()=>setPg(pg+1)}>›</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── JOB ORDERS PAGE ─────────────────────────────────────────────────────────
function JobOrdersPage({assets, jobOrders, setJoModal, setJoViewModal, onStatusChange}) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const filtered = jobOrders.filter(j=>{
    const hay = [j.jobNo,j.assetNum,j.assetDesc,j.dept,j.problem].join(' ').toLowerCase();
    return (!q||hay.includes(q.toLowerCase())) && (!status||j.status===status);
  }).reverse();
  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
        <div>
          <div className="page-title">JOB <span>ORDERS</span></div>
          <div className="page-sub">MAINTENANCE JOB CARD REQUEST LOG</div>
        </div>
        <div className="controls">
          <input className="search-box" value={q} onChange={e=>setQ(e.target.value)} placeholder="🔍 Search job orders..."/>
          <select value={status} onChange={e=>setStatus(e.target.value)}>
            <option value="">All Status</option>
            <option>OPEN</option><option>IN PROGRESS</option><option>CLOSED</option>
          </select>
          <button className="btn btn-accent" onClick={()=>setJoModal({mode:'add'})}>＋ Raise Job Order</button>
        </div>
      </div>
      <div className="panel" style={{marginTop:16}}>
        <div className="tbl-wrap">
          <table>
            <thead><tr>
              <th>Job No.</th><th>Date</th><th>Asset</th><th>Dept</th><th>Problem</th>
              <th>Priority</th><th>Completed</th><th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {filtered.length===0 && <tr><td colSpan={9}><div className="empty-state"><div style={{fontSize:40}}>📋</div><div>No job orders yet</div></div></td></tr>}
              {filtered.map(jo=>(
                <tr key={jo.jobNo}>
                  <td style={{fontFamily:'var(--fm)',fontSize:12,color:'var(--accent)'}}>{jo.jobNo}</td>
                  <td style={{fontSize:12}}>{jo.date}</td>
                  <td><strong>{jo.assetNum}</strong><div style={{fontSize:11,color:'var(--gray)'}}>{jo.assetDesc||''}</div></td>
                  <td style={{fontSize:12}}>{jo.dept||'—'}</td>
                  <td style={{fontSize:12,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{jo.problem||'—'}</td>
                  <td><span className={jo.priority==='High'?'prio-high':'prio-low'}>{jo.priority}</span></td>
                  <td style={{fontFamily:'var(--fm)',fontSize:12,color:jo.completionDate?'var(--green)':'var(--gray)'}}>{jo.completionDate||'—'}</td>
                  <td>
                    <select className={`sb-base ${joStatusCls(jo.status)}`} value={jo.status} onChange={e=>onStatusChange(jo.jobNo,e.target.value)}>
                      <option>OPEN</option><option>IN PROGRESS</option><option>CLOSED</option>
                    </select>
                  </td>
                  <td>
                    <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                      <button className="btn btn-ghost btn-sm" onClick={()=>setJoViewModal(jo)}>View</button>
                      <button className="btn btn-warning btn-sm" onClick={()=>setJoModal({mode:'edit',jo})}>✏ Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── REPORTS PAGE ─────────────────────────────────────────────────────────────
function ReportsPage({assets, jobOrders}) {
  const broken = assets.filter(a=>['BREAKDOWN','UNDER MAINTENANCE','Inactive','idle'].includes(a.status));
  const openJOs = jobOrders.filter(j=>j.status!=='CLOSED');
  return (
    <div>
      <div className="page-header">
        <div className="page-title">REPORTS <span>& ANALYTICS</span></div>
        <div className="page-sub">MAINTENANCE PERFORMANCE OVERVIEW</div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
        <div className="panel">
          <div className="panel-head"><div className="panel-title">⚠ Non-Operational Assets ({broken.length})</div></div>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Asset No.</th><th>Description</th><th>Location</th><th>Status</th></tr></thead>
              <tbody>
                {broken.length===0&&<tr><td colSpan={4} style={{textAlign:'center',color:'var(--gray)',padding:20}}>All assets operational ✓</td></tr>}
                {broken.map(a=><tr key={a.num}>
                  <td style={{fontFamily:'var(--fm)',fontSize:12,color:'var(--accent)'}}>{a.num}</td>
                  <td><strong>{a.desc}</strong></td>
                  <td style={{fontSize:12}}>{a.loc||'—'}</td>
                  <td><span className={`sb-base ${statusCls(a.status)}`}>{a.status}</span></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><div className="panel-title">📋 Open Job Orders ({openJOs.length})</div></div>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Job No.</th><th>Asset</th><th>Priority</th><th>Status</th></tr></thead>
              <tbody>
                {openJOs.length===0&&<tr><td colSpan={4} style={{textAlign:'center',color:'var(--gray)',padding:20}}>No open job orders ✓</td></tr>}
                {openJOs.map(j=><tr key={j.jobNo}>
                  <td style={{fontFamily:'var(--fm)',fontSize:12,color:'var(--accent)'}}>{j.jobNo}</td>
                  <td style={{fontSize:12}}>{j.assetNum} {j.assetDesc}</td>
                  <td><span className={j.priority==='High'?'prio-high':'prio-low'}>{j.priority}</span></td>
                  <td><span className={`sb-base ${joStatusCls(j.status)}`}>{j.status}</span></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="panel" style={{marginTop:20}}>
        <div className="panel-head"><div className="panel-title">📊 Asset Status Summary</div></div>
        <div className="panel-body">
          <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:12}}>
            {[['OPERATIONAL','var(--green)'],['BREAKDOWN','var(--red)'],['UNDER MAINTENANCE','var(--orange)'],['NEW','#60a5fa'],['Inactive','var(--gray)'],['idle','var(--yellow)']].map(([s,c])=>(
              <div key={s} style={{textAlign:'center',background:'rgba(255,255,255,.03)',border:'1px solid var(--border)',borderRadius:8,padding:'16px 8px'}}>
                <div style={{fontFamily:'var(--fh)',fontSize:28,fontWeight:700,color:c}}>{assets.filter(a=>a.status===s).length}</div>
                <div style={{fontSize:10,fontFamily:'var(--fm)',color:'var(--gray)',marginTop:4,letterSpacing:1}}>{s.toUpperCase()}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ASSET VIEW MODAL ─────────────────────────────────────────────────────────
function AssetViewModal({asset:a, assets, jobOrders, onClose, onEdit, onJO}) {
  const rel = jobOrders.filter(j=>j.assetNum===a.num);
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="modal-head">
          <div className="modal-title">{a.num} — {a.desc}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            {[['Asset Number',a.num],['Plant',a.plant],['Description',a.desc],['Equipment Code',a.code||'—'],
              ['Model / Make',a.model||'—'],['Capacity',a.cap||'—'],['Register Number',a.reg||'—'],
              ['Engine Number',a.eng||'—'],['Serial / Chassis No.',a.serial||'—'],['Location',a.loc||'—'],
            ].map(([l,v])=>(
              <div key={l} className="detail-item"><label>{l}</label><div className="val">{v}</div></div>
            ))}
            <div className="detail-item"><label>Status</label><div className="val"><span className={`sb-base ${statusCls(a.status)}`}>{a.status||'—'}</span></div></div>
          </div>
          {rel.length>0&&<div style={{marginTop:16}}>
            <div className="jc-section-title">Related Job Orders</div>
            <table className="parts-table" style={{marginTop:4}}>
              <thead><tr><th>Job No.</th><th>Date</th><th>Problem</th><th>Status</th></tr></thead>
              <tbody>{rel.map(j=><tr key={j.jobNo}><td>{j.jobNo}</td><td>{j.date}</td><td>{(j.problem||'').substring(0,50)}</td><td>{j.status}</td></tr>)}</tbody>
            </table>
          </div>}
          <div style={{marginTop:20,display:'flex',gap:10,justifyContent:'flex-end',flexWrap:'wrap'}}>
            <button className="btn btn-warning" onClick={()=>onEdit(a)}>✏ Edit Asset</button>
            <button className="btn btn-primary" onClick={()=>onJO(a)}>📋 Raise JO</button>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ASSET FORM MODAL ─────────────────────────────────────────────────────────
function AssetFormModal({mode, asset, assets, onClose, onSave}) {
  const [f, setF] = useState(asset ? {...asset} : {num:'',plant:'',desc:'',code:'',model:'',cap:'',reg:'',eng:'',serial:'',loc:'',status:'OPERATIONAL'});
  const [otherPlant, setOtherPlant] = useState('');
  const isOther = !PLANTS.includes(f.plant) && f.plant!=='';

  function handleSave() {
    if (!f.num.trim()) { alert('Asset number required'); return; }
    if (!f.desc.trim()) { alert('Description required'); return; }
    const plant = isOther ? otherPlant : f.plant;
    if (!plant) { alert('Plant required'); return; }
    onSave({...f, plant}, mode==='edit' ? asset.num : null);
  }

  const fld = (label, key, opts={}) => (
    <div className="form-group">
      <label>{label}</label>
      <input type={opts.type||'text'} value={f[key]||''} onChange={e=>setF({...f,[key]:e.target.value})} placeholder={opts.placeholder||''}/>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="modal-head">
          <div className="modal-title">{mode==='add'?'Add New Asset':`Edit Asset — ${asset?.num}`}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {mode==='edit'&&<div className="edit-mode-banner">✏ Editing existing asset — changes will be saved to the registry</div>}
          <div className="form-row">{fld('Asset Number','num')}{fld('Description','desc')}</div>
          <div className="form-row">
            <div className="form-group">
              <label>Plant</label>
              <select value={isOther?'__other__':f.plant} onChange={e=>{
                if(e.target.value==='__other__') setF({...f,plant:''});
                else setF({...f,plant:e.target.value});
              }}>
                <option value="">— Select Plant —</option>
                {PLANTS.map(p=><option key={p}>{p}</option>)}
                <option value="__other__">Other...</option>
              </select>
            </div>
            {isOther&&<div className="form-group"><label>Plant Name</label><input value={otherPlant} onChange={e=>setOtherPlant(e.target.value)} placeholder="Enter plant name"/></div>}
            {!isOther&&fld('Equipment Code','code')}
          </div>
          <div className="form-row">{fld('Model / Make','model')}{fld('Capacity','cap')}</div>
          <div className="form-row">{fld('Register Number','reg')}{fld('Engine Number','eng')}</div>
          <div className="form-row">{fld('Serial / Chassis No.','serial')}{fld('Location','loc')}</div>
          <div className="form-row">
            <div className="form-group">
              <label>Status</label>
              <select value={f.status||'OPERATIONAL'} onChange={e=>setF({...f,status:e.target.value})}>
                {['OPERATIONAL','BREAKDOWN','UNDER MAINTENANCE','NEW','Inactive','idle'].map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{display:'flex',gap:12,justifyContent:'flex-end',marginTop:8}}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-success" onClick={handleSave}>💾 {mode==='add'?'Save Asset':'Update Asset'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── JO FORM MODAL ────────────────────────────────────────────────────────────
function JOFormModal({mode, jo, preAsset, assets, joCounter, onClose, onSave}) {
  const today = new Date().toISOString().split('T')[0];
  const [f, setF] = useState(jo ? {...jo} : {
    date:today, requester:'', dept:'', assetNum:preAsset||'', assetDesc:'', location:'',
    eqcode:'', problem:'', priority:'High', repairType:'Planned',
    recvName:'', section:'', target:'', approved:'Priyantha Athapaththu',
    tech1:'', tech1h:'', tech2:'', tech2h:'', parts:[{desc:'',qty:'',unit:'',srp:''}],
    workDone:'', workStatus:'', eval:'', downtime:'', accept:'Accepted', status:'OPEN', completionDate:'',
  });

  function populateAsset(num) {
    const a = assets.find(x=>x.num===num);
    if (a) setF(prev=>({...prev,assetNum:num,assetDesc:a.desc,location:a.loc||a.plant,eqcode:a.code||''}));
    else setF(prev=>({...prev,assetNum:num}));
  }

  function setParts(idx, key, val) {
    setF(prev=>{
      const parts = [...(prev.parts||[])];
      parts[idx] = {...parts[idx],[key]:val};
      return {...prev,parts};
    });
  }
  function addPart() { setF(prev=>({...prev,parts:[...(prev.parts||[]),{desc:'',qty:'',unit:'',srp:''}]})); }
  function removePart(idx) { setF(prev=>({...prev,parts:(prev.parts||[]).filter((_,i)=>i!==idx)})); }

  function handleSave() {
    if (!f.assetNum) { alert('Please select an asset'); return; }
    if (!f.date) { alert('Please enter a date'); return; }
    onSave(f, mode==='edit' ? jo.jobNo : null);
  }

  const fld = (label, key, opts={}) => (
    <div className="form-group">
      <label>{label}</label>
      {opts.textarea
        ? <textarea value={f[key]||''} onChange={e=>setF({...f,[key]:e.target.value})} placeholder={opts.placeholder||''}/>
        : opts.select
          ? <select value={f[key]||''} onChange={e=>setF({...f,[key]:e.target.value})}>{opts.options.map(o=><option key={o}>{o}</option>)}</select>
          : <input type={opts.type||'text'} value={f[key]||''} onChange={e=>setF({...f,[key]:e.target.value})} placeholder={opts.placeholder||''} readOnly={opts.readonly}/>
      }
    </div>
  );

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{width:860}}>
        <div className="modal-head">
          <div className="modal-title">{mode==='add'?'Raise Job Order':`Edit Job Order — ${jo?.jobNo}`}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {mode==='edit'&&<div className="edit-mode-banner">✏ Editing existing job order</div>}
          <div style={{fontFamily:'var(--fm)',fontSize:11,color:'var(--accent)',marginBottom:12}}>JOB NO: {mode==='edit'?jo.jobNo:`JO-${joCounter+1} (auto)`}</div>

          <div className="jc-section">
            <div className="jc-section-title">Request Information</div>
            <div className="form-row">
              <div className="form-group"><label>Date</label><input type="date" value={f.date} onChange={e=>setF({...f,date:e.target.value})}/></div>
              {fld('Requested By','requester')}
            </div>
            <div className="form-row">{fld('Department','dept')}</div>
          </div>

          <div className="jc-section">
            <div className="jc-section-title">Equipment Details</div>
            <div className="form-row">
              <div className="form-group">
                <label>Asset Number</label>
                <select value={f.assetNum||''} onChange={e=>populateAsset(e.target.value)}>
                  <option value="">— Select Asset —</option>
                  {assets.map(a=><option key={a.num} value={a.num}>{a.num} — {a.desc}</option>)}
                </select>
              </div>
              {fld('Asset Description','assetDesc',{readonly:true})}
            </div>
            <div className="form-row">{fld('Plant / Location','location',{readonly:true})}{fld('Equipment Code','eqcode',{readonly:true})}</div>
          </div>

          <div className="jc-section">
            <div className="jc-section-title">Problem Details</div>
            <div className="form-row single">{fld('Details of the Problem','problem',{textarea:true,placeholder:'Describe the problem...'})}</div>
            <div style={{display:'flex',gap:30,flexWrap:'wrap',marginTop:4}}>
              <div>
                <label style={{fontSize:11,fontFamily:'var(--fm)',color:'var(--gray)',letterSpacing:1,textTransform:'uppercase',display:'block',marginBottom:8}}>Priority</label>
                <div className="checkbox-row">
                  {['High','Low'].map(p=><label key={p} className="checkbox-item"><input type="radio" name="prio" checked={f.priority===p} onChange={()=>setF({...f,priority:p})}/><span style={p==='High'?{color:'var(--red)',fontWeight:600}:{color:'var(--green)'}}>{p==='High'?'⚡ HIGH':'LOW'}</span></label>)}
                </div>
              </div>
              <div>
                <label style={{fontSize:11,fontFamily:'var(--fm)',color:'var(--gray)',letterSpacing:1,textTransform:'uppercase',display:'block',marginBottom:8}}>Type of Repair</label>
                <div className="checkbox-row">
                  {['Planned','Unplanned'].map(t=><label key={t} className="checkbox-item"><input type="radio" name="rtype" checked={f.repairType===t} onChange={()=>setF({...f,repairType:t})}/>{t}</label>)}
                </div>
              </div>
            </div>
          </div>

          <div className="jc-section">
            <div className="jc-section-title">Authorisation</div>
            <div className="form-row">{fld('Received By','recvName')}{fld('Section Assigned','section')}</div>
            <div className="form-row">
              <div className="form-group"><label>Target Completion</label><input type="date" value={f.target||''} onChange={e=>setF({...f,target:e.target.value})}/></div>
              {fld('Approved By','approved',{readonly:true})}
            </div>
          </div>

          <div className="jc-section">
            <div className="jc-section-title">Manpower Utilisation</div>
            <div className="form-row">{fld('Technician 1','tech1')}{fld('Hours Attended','tech1h',{type:'number'})}</div>
            <div className="form-row">{fld('Technician 2','tech2')}{fld('Hours Attended','tech2h',{type:'number'})}</div>
          </div>

          <div className="jc-section">
            <div className="jc-section-title">Material / Spare Parts</div>
            <table className="parts-table">
              <thead><tr><th style={{width:'48%'}}>Description</th><th style={{width:'12%'}}>Qty</th><th style={{width:'14%'}}>Unit</th><th style={{width:'18%'}}>SRP</th><th style={{width:'8%'}}></th></tr></thead>
              <tbody>
                {(f.parts||[]).map((p,i)=>(
                  <tr key={i}>
                    <td><input value={p.desc||''} onChange={e=>setParts(i,'desc',e.target.value)} placeholder="Description"/></td>
                    <td><input type="number" value={p.qty||''} onChange={e=>setParts(i,'qty',e.target.value)} placeholder="0"/></td>
                    <td><input value={p.unit||''} onChange={e=>setParts(i,'unit',e.target.value)} placeholder="pcs"/></td>
                    <td><input value={p.srp||''} onChange={e=>setParts(i,'srp',e.target.value)} placeholder="0.00"/></td>
                    <td><button className="btn btn-danger btn-sm" onClick={()=>removePart(i)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn btn-ghost btn-sm" style={{marginTop:8}} onClick={addPart}>＋ Add Row</button>
          </div>

          <div className="jc-section">
            <div className="jc-section-title">Service Report</div>
            <div className="form-row single">{fld('Details of Work Done','workDone',{textarea:true,placeholder:'Describe work carried out...'})}</div>
            <div style={{display:'flex',gap:30,flexWrap:'wrap',marginTop:8}}>
              <div>
                <label style={{fontSize:11,fontFamily:'var(--fm)',color:'var(--gray)',letterSpacing:1,textTransform:'uppercase',display:'block',marginBottom:8}}>Work Status</label>
                <div className="checkbox-row">
                  {['Work Completed Successful','Temporary Repaired'].map(s=><label key={s} className="checkbox-item"><input type="radio" name="ws" checked={f.workStatus===s} onChange={()=>setF({...f,workStatus:s})}/>{s==='Work Completed Successful'?'Completed ✓':'Temporary Repaired'}</label>)}
                </div>
              </div>
              <div>
                <label style={{fontSize:11,fontFamily:'var(--fm)',color:'var(--gray)',letterSpacing:1,textTransform:'uppercase',display:'block',marginBottom:8}}>Evaluation</label>
                <div className="checkbox-row">
                  {['Very Good','Good','Satisfied','Not Satisfied'].map(e=><label key={e} className="checkbox-item"><input type="radio" name="ev" checked={f.eval===e} onChange={()=>setF({...f,eval:e})}/>{e}</label>)}
                </div>
              </div>
            </div>
            <div className="form-row" style={{marginTop:14}}>
              {fld('Downtime (hours)','downtime',{type:'number'})}
              <div className="form-group">
                <label>Acceptance</label>
                <select value={f.accept||'Accepted'} onChange={e=>setF({...f,accept:e.target.value})}>
                  <option value="Accepted">Accepted the repair</option>
                  <option value="Rejected">Rejected the repair</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Job Order Status</label>
                <select value={f.status||'OPEN'} onChange={e=>setF({...f,status:e.target.value})}>
                  <option>OPEN</option><option>IN PROGRESS</option><option>CLOSED</option>
                </select>
              </div>
              <div className="form-group"><label>✅ Completion Date</label><input type="date" value={f.completionDate||''} onChange={e=>setF({...f,completionDate:e.target.value})}/></div>
            </div>
          </div>

          <div style={{display:'flex',gap:12,justifyContent:'flex-end',marginTop:6}}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-success" onClick={handleSave}>💾 {mode==='add'?'Save Job Order':'Update Job Order'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── JO VIEW MODAL ────────────────────────────────────────────────────────────
function JOViewModal({jo, onClose, onEdit}) {
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal" style={{width:860}}>
        <div className="modal-head">
          <div className="modal-title">{jo.jobNo} — Job Card</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>
            {[['Job No.',<span style={{fontFamily:'var(--fm)',color:'var(--accent)'}}>{jo.jobNo}</span>],
              ['Date',jo.date],
              ['Status',<span className={`sb-base ${joStatusCls(jo.status)}`}>{jo.status}</span>],
              ['Requested By',jo.requester||'—'],['Department',jo.dept||'—'],
              ['Priority',<span className={jo.priority==='High'?'prio-high':'prio-low'}>{jo.priority}</span>],
              ['Asset No.',<span style={{fontFamily:'var(--fm)'}}>{jo.assetNum}</span>],
              ['Asset Description',jo.assetDesc||'—'],['Location',jo.location||'—'],
            ].map(([l,v])=>(
              <div key={l} className="detail-item"><label>{l}</label><div className="val">{v}</div></div>
            ))}
          </div>
          <div className="jc-section"><div className="jc-section-title">Problem Details</div><p style={{fontSize:13}}>{jo.problem||'—'}</p></div>
          <div className="jc-section">
            <div className="jc-section-title">Work Done</div>
            <p style={{fontSize:13}}>{jo.workDone||'—'}</p>
            <div style={{display:'flex',gap:20,marginTop:8,fontSize:12,flexWrap:'wrap'}}>
              <span>Repair Type: <strong>{jo.repairType||'—'}</strong></span>
              <span>Work Status: <strong>{jo.workStatus||'—'}</strong></span>
              <span>Downtime: <strong>{jo.downtime||'0'} hrs</strong></span>
              <span>Evaluation: <strong>{jo.eval||'—'}</strong></span>
            </div>
          </div>
          <div className="jc-section">
            <div className="jc-section-title">Manpower</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,fontSize:13}}>
              <div>Tech 1: <strong>{jo.tech1||'—'}</strong> ({jo.tech1h||'0'} hrs)</div>
              <div>Tech 2: <strong>{jo.tech2||'—'}</strong> ({jo.tech2h||'0'} hrs)</div>
              <div>Section: <strong>{jo.section||'—'}</strong></div>
              <div>Approved By: <strong>{jo.approved||'—'}</strong></div>
              <div>Target: <strong>{jo.target||'—'}</strong></div>
              <div>Completion: <strong style={{color:'var(--green)'}}>{jo.completionDate||'—'}</strong></div>
            </div>
          </div>
          <div className="jc-section">
            <div className="jc-section-title">Materials / Parts</div>
            <table className="parts-table">
              <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>SRP</th></tr></thead>
              <tbody>
                {(jo.parts||[]).filter(p=>p.desc).map((p,i)=><tr key={i}><td>{p.desc}</td><td>{p.qty}</td><td>{p.unit}</td><td>{p.srp}</td></tr>)}
                {!(jo.parts||[]).filter(p=>p.desc).length&&<tr><td colSpan={4} style={{color:'var(--gray)',fontSize:12}}>No parts recorded</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{marginTop:16,display:'flex',gap:10,justifyContent:'flex-end',flexWrap:'wrap'}}>
            <button className="btn btn-warning" onClick={()=>onEdit(jo)}>✏ Edit</button>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
