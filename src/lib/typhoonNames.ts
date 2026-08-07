// ── 西北太平洋颱風 國際名 → 中文譯名（中央氣象署 CWA 慣用）──────────
//
// GDACS 免金鑰來源只給英文名（如 DOLPHIN-26）。這裡對照 CWA 官方中文譯名，
// 讓免金鑰模式也能顯示「海豚」。只收錄有把握的譯名；查不到就回 null，
// 由呼叫端沿用英文，絕不亂猜（錯的中文名比英文更糟）。

/** 國際名（去空格/連字號、大寫）→ 中文。缺漏者回退英文，不虛構。 */
const ZH: Record<string, string> = {
  DAMREY: '丹瑞', HAIKUI: '海葵', KIROGI: '鴻雁', YUNYEUNG: '鴛鴦', KOINU: '小犬',
  BOLAVEN: '布拉萬', SANBA: '三巴', JELAWAT: '杰拉華', EWINIAR: '艾維尼', MALIKSI: '馬力斯',
  GAEMI: '凱米', PRAPIROON: '巴比侖', MARIA: '瑪莉亞', SONTINH: '山神', AMPIL: '安比',
  WUKONG: '悟空', JONGDARI: '雲雀', SHANSHAN: '珊珊', YAGI: '摩羯', LEEPI: '麗琵',
  BEBINCA: '貝碧嘉', PULASAN: '普拉桑', SOULIK: '蘇力', CIMARON: '西馬隆', JEBI: '燕子',
  KRATHON: '山陀兒', BARIJAT: '百里嘉', TRAMI: '潭美', KONGREY: '康芮', YINXING: '銀杏',
  TORAJI: '桔梗', USAGI: '天兔', MANYI: '萬宜', PABUK: '帕布', WUTIP: '蝴蝶',
  SEPAT: '聖帕', MUN: '木恩', DANAS: '丹娜絲', NARI: '百合', WIPHA: '韋帕',
  FRANCISCO: '范斯高', KROSA: '柯羅莎', BAILU: '白鹿', PODUL: '楊柳', LINGLING: '玲玲',
  KAJIKI: '劍魚', PEIPAH: '琵琶', TAPAH: '塔巴', MITAG: '米塔', HAGIBIS: '哈吉貝',
  NEOGURI: '浣熊', BUALOI: '布拉洛', MATMO: '麥德姆', HALONG: '哈隆', NAKRI: '娜克莉',
  FENGSHEN: '風神', KALMAEGI: '海鷗', FUNGWONG: '鳳凰', KAMMURI: '北冕', PHANFONE: '巴逢',
  VONGFONG: '黃蜂', NURI: '鸚鵡', SINLAKU: '辛樂克', HAGUPIT: '哈格比', JANGMI: '薔蜜',
  MEKKHALA: '米克拉', HIGOS: '無花果', BAVI: '巴威', MAYSAK: '美莎克', HAISHEN: '海神',
  NOUL: '紅霞', DOLPHIN: '白海豚', KUJIRA: '鯨魚', CHANHOM: '昌鴻', LINFA: '蓮花',
  NANGKA: '南卡', SAUDEL: '沙德爾', MOLAVE: '莫拉菲', GONI: '天鵝', ATSANI: '艾莎尼',
  ETAU: '閃電', VAMCO: '梵高', KROVANH: '科羅旺', DUJUAN: '杜鵑', SURIGAE: '舒力基',
  CHOIWAN: '彩雲', KOGUMA: '小熊', INFA: '烟花', CEMPAKA: '查帕卡', NEPARTAK: '尼伯特',
  LUPIT: '盧碧', MIRINAE: '銀河', NIDA: '妮妲', OMAIS: '奧麥斯', CONSON: '康森',
  CHANTHU: '璨樹', DIANMU: '電母', MINDULLE: '敏督利', LIONROCK: '獅子山', KOMPASU: '圓規',
  MALOU: '瑪瑙', NYATOH: '妮亞圖', RAI: '雷伊', MALAKAS: '馬勒卡', MEGI: '米雷',
  CHABA: '芙蓉', AERE: '艾利', SONGDA: '桑達', MULAN: '木蘭', MAON: '馬鞍',
  TOKAGE: '蝎虎', HINNAMNOR: '軒嵐諾', MUIFA: '梅花', MERBOK: '莫柏', NANMADOL: '南瑪都',
  TALAS: '塔拉斯', NORU: '諾盧', KULAP: '庫拉', ROKE: '洛克', SONCA: '桑卡',
  NESAT: '尼莎', HAITANG: '海棠', NALGAE: '奈格', BANYAN: '榕樹', MAWAR: '瑪娃',
  GUCHOL: '谷超', TALIM: '泰利', DOKSURI: '杜蘇芮', KHANUN: '卡努', LAN: '蘭恩',
  SAOLA: '蘇拉', PAKHAR: '帕卡',
}

/** 去掉 GDACS 常見的尾碼（-26 / 空格數字），並過濾成純字母大寫。 */
function normalize(s: string): string {
  return s
    .replace(/[-\s]\d+$/, '') // DOLPHIN-26 → DOLPHIN
    .toUpperCase()
    .replace(/[^A-Z]/g, '') // SON-TINH → SONTINH
}

/** 取乾淨英文名（去尾碼），供顯示 nameEn。 */
export function cleanTyphoonNameEn(raw: string): string {
  return raw.replace(/[-\s]\d+$/, '').trim()
}

/** 國際名 → 中文譯名；查不到回 null（呼叫端沿用英文，不虛構）。 */
export function zhTyphoonName(raw: string): string | null {
  return ZH[normalize(raw)] ?? null
}
