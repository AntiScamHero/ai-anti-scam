// simulator.js - AI 防詐盾牌｜正式版防詐教室
// 特色：無 inline script、隨機情境、加權評分、模糊容錯、狀態與畫面分離、後端不可用也能完整演練。
(function () {
  'use strict';

  const CLASSROOM_CONFIG = {
    typingDelayMs: 950,
    coachDelayMs: 780,
    maxRecentScenarioIds: 6,
    score: {
      base: 50,
      safeStrong: 22,
      safeMedium: 14,
      safeWeak: 8,
      riskyStrong: -30,
      riskyMedium: -20,
      riskyWeak: -12,
      conflictPenalty: -18,
      directTransferPenalty: -24,
      otpPenalty: -26,
      familyBonus: 16,
      officialBonus: 14,
      refusalBonus: 18
    },
    thresholds: {
      safe: 72,
      caution: 45
    },
    demoFailSafeTimeoutMs: 8000,
    defaultSafetyReply: '網路或瀏覽器反應稍慢，請先記住防詐三步驟：一停、二查、三問家人或打 165。遇到匯款、驗證碼、信用卡或下載 App，先不要操作。'
  };

  const DOM_IDS = {
    title: 'scenario-title',
    meta: 'scenario-meta',
    chat: 'chat-box',
    input: 'user-input',
    send: 'send-btn',
    next: 'next-btn',
    restart: 'restart-btn',
    scoreNum: 'score-num',
    scoreLabel: 'score-label',
    scoreBar: 'score-bar',
    reasons: 'reason-list',
    lessons: 'lesson-list',
    quickVerify: 'quick-verify',
    quickFamily: 'quick-family',
    quickRefuse: 'quick-refuse',
    quickRisky: 'quick-risky',
    voice: 'voice-btn',
    scoreIcon: 'score-icon',
    coachDetail: 'coach-detail',
    lessonDetail: 'lesson-detail',
    lessonVideoCard: 'lesson-video-card',
    lessonVideoTitle: 'lesson-video-title',
    lessonVideoDesc: 'lesson-video-desc',
    lessonVideoTag: 'lesson-video-tag',
    lessonVideoPlayer: 'lesson-video-player',
    lessonVideoSource: 'lesson-video-source',
    lessonVideoNote: 'lesson-video-note',
    lessonProgress: 'lesson-progress',
    startPractice: 'start-practice-btn',
    practiceArea: 'practice-area',
    modeCourse: 'mode-course-btn',
    modeChallenge: 'mode-challenge-btn'
  };

  const SAFE_RULES = [
    { label: '明確拒絕照做', weight: CLASSROOM_CONFIG.score.refusalBonus, terms: ['不要', '不會', '拒絕', '不提供', '不給', '不能給', '不匯', '不轉帳', '不操作', '掛掉', '免啦', '先不要', '我不要', '毋通', '不行', '不用', '不要理他', '先不處理'] },
    { label: '提出查證行動', weight: CLASSROOM_CONFIG.score.officialBonus, terms: ['查證', '確認', '官方', '官網', '客服', '銀行', '平台', '物流', '政府網站', '原本電話', '打電話問', '打去問', '問客服', '查一下', '看官方', '先查'] },
    { label: '尋求可信任協助', weight: CLASSROOM_CONFIG.score.familyBonus, terms: ['家人', '兒子', '女兒', '孫子', '孫女', '先生', '太太', '朋友', '警察', '165', '110', '醫院', '藥師', '醫師', '行員', '問小孩', '問孩子', '問家裡的人'] },
    { label: '保護個資與驗證碼', weight: CLASSROOM_CONFIG.score.safeMedium, terms: ['不輸入', '不登入', '不掃', '不點', '驗證碼不能', '密碼不能', '信用卡不能', 'otp不能', '不給驗證碼', '不給密碼', '不給卡號', '不按連結', '不要按連結'] },
    { label: '保留證據或暫停操作', weight: CLASSROOM_CONFIG.score.safeWeak, terms: ['截圖', '保存證據', '先停', '停下來', '冷靜', '等一下'] }
  ];

  const RISKY_RULES = [
    { label: '仍可能提供金錢或轉帳', weight: CLASSROOM_CONFIG.score.directTransferPenalty, terms: ['匯款', '轉帳', '付款', '繳錢', '入金', '儲值', '保證金', '手續費', '稅金', '先付', '付一下', '匯一下', '轉一下'] },
    { label: '仍可能提供驗證碼或密碼', weight: CLASSROOM_CONFIG.score.otpPenalty, terms: ['驗證碼', 'otp', '密碼', '卡號', '信用卡', '提款卡', 'cvv', '背面三碼', '網銀', '簡訊碼', '認證碼', '金融卡', '銀行帳號'] },
    { label: '可能繼續配合對方指示', weight: CLASSROOM_CONFIG.score.riskyMedium, terms: ['照做', '給你', '我給', '我輸入', '我掃', '我點', '加line', '加賴', '私訊'] },
    { label: '受急迫壓力影響', weight: CLASSROOM_CONFIG.score.riskyWeak, terms: ['很急', '馬上', '立即', '現在就', '怕來不及', '先處理'] }
  ];

  const NEGATION_TERMS = ['不', '不要', '不會', '不能', '拒絕', '不提供', '不給', '不匯', '不轉', '不輸入', '不點', '不掃', '先不要'];
  const SAFE_QUICK_REPLIES = {
    verify: '我不會直接照做，我要先到官方網站或官方電話查證。',
    family: '我先不要操作，我要先問家人確認這是不是詐騙。',
    refuse: '我不提供信用卡、密碼、驗證碼，也不會匯款。',
    risk: '我直接照做，點立即領取並加入 LINE 群組。'
  };



  const VIDEO_LESSONS = [
  {
    "id": "fake_claim",
    "title": "第一課：假補助／立即領取詐騙",
    "desc": "用生活故事練習辨識「立即領取、限時操作、要求個資」這些高風險警訊。",
    "tag": "假補助詐騙",
    "src": "../assets/videos/lesson1-fake-claim.mp4",
    "note": "看完影片後，換你判斷：如果是你遇到這種情況，你會怎麼做？",
    "scenarios": [
      {
        "id": "lesson1_claim_button",
        "title": "如果是你，你會怎麼做？",
        "category": "假補助詐騙",
        "lesson": [
          "不要急著點立即領取",
          "先查官方網站或打165",
          "不要輸入身分證、信用卡或驗證碼"
        ],
        "scammer": [
          "阿盾老師問你：你滑手機時，突然看到一個很像政府補助的網頁。",
          "上面寫著：「政府補助金開放領取」，旁邊有一顆很大的「立即領取」按鈕，還提醒剩下10分鐘。",
          "你心想：「如果真的可以領補助，錯過就可惜了。」這時網頁要求你填身分證、手機和銀行資料。你會怎麼做？"
        ],
        "riskyFollowups": [
          "快一點填資料，逾時就不能領補助了。"
        ],
        "coachSafe": "做得好。你有先停下來查證，沒有直接輸入個資，這就是安全做法。",
        "coachRisky": "這個回覆仍有風險。假補助常用「立即領取、限時完成、填個資」來騙資料。"
      },
      {
        "id": "lesson1_sms_claim",
        "title": "如果是你，你會怎麼做？",
        "category": "假補助詐騙",
        "lesson": [
          "補助訊息要查官方來源",
          "不要點陌生簡訊連結",
          "不要提供金融資料"
        ],
        "scammer": [
          "阿盾老師問你：你今天收到一封簡訊，說你符合「防疫補助」或「生活補助」資格。",
          "簡訊說只要點進連結，填完資料就可以領 6000 元，還寫著：「今日最後一天」。",
          "你最近剛好有聽到政府補助新聞，心裡有點相信。這時你會直接點連結填資料嗎？"
        ],
        "riskyFollowups": [
          "今天最後一天，沒有填就視同放棄補助。"
        ],
        "coachSafe": "很好。補助要回官方網站或打官方電話查證，不要從陌生簡訊連結進入。",
        "coachRisky": "這個回覆仍要小心。詐騙常把真新聞包裝成假連結，誘導你填個資。"
      },
      {
        "id": "lesson1_line_assist",
        "title": "如果是你，你會怎麼做？",
        "category": "假補助詐騙",
        "lesson": [
          "免費協助也可能是誘餌",
          "不要加入陌生LINE群組",
          "不要傳身分證照片或帳戶資料"
        ],
        "scammer": [
          "阿盾老師問你：你在社群看到「免費幫忙申請補助」的貼文，底下很多人留言說成功領到錢。",
          "你加入 LINE 後，對方說：「我可以幫你保留名額，先傳身分證正反面、存摺封面和電話給我。」",
          "你覺得對方好像很熱心，又怕自己不會申請。這時你會把資料傳給他嗎？"
        ],
        "riskyFollowups": [
          "你先傳資料來，我才能幫你保留名額。"
        ],
        "coachSafe": "做得好。身分證、存摺、電話都是重要資料，不能交給陌生人代辦。",
        "coachRisky": "這個回覆仍有風險。免費代辦、保留名額、要求證件資料，是常見騙個資手法。"
      },
      {
        "id": "lesson1_qrcode_form",
        "title": "如果是你，你會怎麼做？",
        "category": "假補助詐騙",
        "lesson": [
          "不要掃不明QRCode",
          "表單要確認來源",
          "有疑問先問家人或165"
        ],
        "scammer": [
          "阿盾老師問你：你在菜市場或社群看到一張海報，上面寫著：「長者補助快速申請」。",
          "海報放了一個 QR Code，寫著：「掃碼填表，最快今天入帳」。",
          "你看到「長者專屬」覺得好像跟自己有關。這時你會直接掃碼填資料嗎？"
        ],
        "riskyFollowups": [
          "掃碼填表最快，現場名額有限。"
        ],
        "coachSafe": "很好。看到 QR Code 也要確認來源，不要直接填個資或帳戶資料。",
        "coachRisky": "這個回覆要小心。不明 QR Code 可能帶你到假表單或釣魚網站。"
      }
    ]
  },
  {
    "id": "fake_link",
    "title": "第二課：假通知／假連結詐騙",
    "desc": "用生活故事練習辨識陌生連結、要求登入、驗證碼和信用卡資料。",
    "tag": "假連結詐騙",
    "src": "../assets/videos/lesson2-fake-link.mp4",
    "note": "看完影片後，換你判斷：遇到陌生連結時，第一步該怎麼做？",
    "scenarios": [
      {
        "id": "lesson2_login_link",
        "title": "如果是你，你會怎麼做？",
        "category": "假連結詐騙",
        "lesson": [
          "不要點陌生連結",
          "不要在不明頁面登入帳號",
          "回官方App或官方網站查證"
        ],
        "scammer": [
          "阿盾老師問你：你收到一封簡訊，內容寫著：「您的帳號即將停用」。",
          "簡訊附了一個連結，要求你今天內重新登入，完成安全驗證。",
          "你想到這個帳號平常有在用，擔心真的被停用。這時你會點進去登入嗎？"
        ],
        "riskyFollowups": [
          "這是最後提醒，請現在登入完成驗證。"
        ],
        "coachSafe": "做得好。遇到登入連結，應該回官方 App 或官方網站查證。",
        "coachRisky": "這個回覆有風險。陌生登入連結很可能是假網站，用來盜帳號密碼。"
      },
      {
        "id": "lesson2_otp_code",
        "title": "如果是你，你會怎麼做？",
        "category": "假連結詐騙",
        "lesson": [
          "驗證碼不能給任何人",
          "銀行與客服不會索取驗證碼",
          "立刻停止並詢問可信任的人"
        ],
        "scammer": [
          "阿盾老師問你：你接到一通自稱客服的電話，對方說你的帳號被異常登入。",
          "電話那頭說：「等一下你會收到 6 位數驗證碼，請唸給我確認，我才能幫你取消。」",
          "你手機真的收到驗證碼了。這時你會把驗證碼唸給對方嗎？"
        ],
        "riskyFollowups": [
          "你不給驗證碼，我沒辦法幫你取消交易。"
        ],
        "coachSafe": "很好。驗證碼、密碼、信用卡資料都不能提供給任何人。",
        "coachRisky": "這個回覆仍有風險。只要對方要求驗證碼，就要立刻停止。"
      },
      {
        "id": "lesson2_bank_notice",
        "title": "如果是你，你會怎麼做？",
        "category": "假連結詐騙",
        "lesson": [
          "銀行通知要回官方App查",
          "不要用簡訊連結登入網銀",
          "不要提供帳密與驗證碼"
        ],
        "scammer": [
          "阿盾老師問你：你手機突然跳出一封「銀行安全通知」。",
          "內容寫著：「您的帳戶有異常交易，請立即點擊連結解除限制。」",
          "你一看到銀行兩個字就緊張，怕錢被盜走。這時你會點連結處理嗎？"
        ],
        "riskyFollowups": [
          "若未立即解除限制，帳戶將暫停使用。"
        ],
        "coachSafe": "做得好。銀行問題要自己打官方電話或開官方 App，不要點簡訊連結。",
        "coachRisky": "這個回覆有風險。假銀行連結會偷走你的帳號、密碼和驗證碼。"
      },
      {
        "id": "lesson2_prize_link",
        "title": "如果是你，你會怎麼做？",
        "category": "假連結詐騙",
        "lesson": [
          "中獎通知要查證",
          "不要為領獎填信用卡",
          "不要下載不明App"
        ],
        "scammer": [
          "阿盾老師問你：你收到通知說：「恭喜中獎！獲得超市禮券 3000 元。」",
          "通知說只要點連結填資料，就可以安排寄送，但需要先輸入信用卡做身分確認。",
          "你覺得只是確認身分，應該不會扣錢。這時你會填信用卡嗎？"
        ],
        "riskyFollowups": [
          "只是身分確認，不會扣款，請放心輸入。"
        ],
        "coachSafe": "很好。領獎不應該要求信用卡資料，先查官方活動才安全。",
        "coachRisky": "這個回覆仍有風險。假中獎常用禮券、免費商品騙個資與信用卡。"
      }
    ]
  },
  {
    "id": "fake_investment",
    "title": "第三課：假投資老師詐騙",
    "desc": "用生活故事練習辨識保證獲利、老師帶單、加入群組與要求入金。",
    "tag": "假投資詐騙",
    "src": "../assets/videos/lesson3-fake-investment.mp4",
    "note": "第3支影片放入後會自動播放；目前若影片讀不到，系統會先開放故事互動。",
    "scenarios": [
      {
        "id": "lesson3_line_group",
        "title": "如果是你，你會怎麼做？",
        "category": "假投資詐騙",
        "lesson": [
          "保證獲利就是警訊",
          "不要加入陌生投資群",
          "不要下載不明投資App"
        ],
        "scammer": [
          "阿盾老師問你：你被莫名加入一個投資 LINE 群組，裡面每天都有人貼賺錢截圖。",
          "一位自稱老師的人私訊你：「今天開放 VIP 名額，跟著我買，明天就會漲。」",
          "看到大家都說有賺到錢，你會下載他給的投資 App，試試看嗎？"
        ],
        "riskyFollowups": [
          "名額快滿了，現在不加入就沒有機會。"
        ],
        "coachSafe": "很好。保證獲利、老師帶單、陌生投資群都是高風險警訊。",
        "coachRisky": "這個回覆仍有風險。假投資常用「老師、VIP、保證獲利」誘導入金。"
      },
      {
        "id": "lesson3_deposit",
        "title": "如果是你，你會怎麼做？",
        "category": "假投資詐騙",
        "lesson": [
          "不要匯款到陌生帳戶",
          "不要相信穩賺不賠",
          "先問家人或165"
        ],
        "scammer": [
          "阿盾老師問你：你的投資 App 顯示已經獲利 58,000 元，看起來很開心。",
          "客服卻說：「要把獲利領出來，需要先繳 8,000 元保證金。」",
          "你心想只差一步就能領錢。這時你會先轉帳繳保證金嗎？"
        ],
        "riskyFollowups": [
          "只差一步就能領錢，請先轉保證金。"
        ],
        "coachSafe": "做得好。領錢前要求先繳保證金，是常見假投資詐騙。",
        "coachRisky": "這個回覆仍有風險。任何要求先匯款、先繳保證金，都要立刻停止。"
      },
      {
        "id": "lesson3_celebrity_ad",
        "title": "如果是你，你會怎麼做？",
        "category": "假投資詐騙",
        "lesson": [
          "名人廣告可能被冒用",
          "不要相信保證獲利",
          "投資前查合法平台"
        ],
        "scammer": [
          "阿盾老師問你：你滑到一則影片，裡面像是某位名人在推薦投資平台。",
          "廣告寫著：「每天跟單，退休金也能穩定增加」，還說現在註冊送體驗金。",
          "你覺得名人都推薦了，應該可靠。這時你會點進去註冊嗎？"
        ],
        "riskyFollowups": [
          "名人也在用，現在註冊才有體驗金。"
        ],
        "coachSafe": "很好。名人影片可能是盜用或偽造，投資平台一定要查證。",
        "coachRisky": "這個回覆仍要小心。名人推薦、保證獲利、送體驗金，都是常見假投資誘餌。"
      },
      {
        "id": "lesson3_friend_recommend",
        "title": "如果是你，你會怎麼做？",
        "category": "假投資詐騙",
        "lesson": [
          "熟人推薦也要查證",
          "不要急著入金",
          "不要把錢匯到私人帳戶"
        ],
        "scammer": [
          "阿盾老師問你：一位很久沒聯絡的朋友突然傳訊息，說他最近靠投資賺了不少。",
          "他說：「我不是亂介紹，這個老師很準，你先匯 20,000 元，我幫你卡位。」",
          "因為是認識的人，你比較放下戒心。這時你會匯錢請他幫忙嗎？"
        ],
        "riskyFollowups": [
          "我自己也有賺，你相信我，先匯錢卡位。"
        ],
        "coachSafe": "很好。就算是認識的人，也可能帳號被盜或被詐騙利用，要先查證。",
        "coachRisky": "這個回覆有風險。熟人推薦不等於安全，匯款前一定要查證。"
      }
    ]
  },
  {
    "id": "fake_parcel",
    "title": "第四課：假包裹／補繳運費詐騙",
    "desc": "用生活故事練習辨識包裹異常、補繳小額運費、陌生簡訊連結。",
    "tag": "假包裹詐騙",
    "src": "../assets/videos/lesson4-fake-parcel.mp4",
    "note": "第4支影片放入後會自動播放；目前若影片讀不到，系統會先開放故事互動。",
    "scenarios": [
      {
        "id": "lesson4_shipping_fee",
        "title": "如果是你，你會怎麼做？",
        "category": "假包裹詐騙",
        "lesson": [
          "不要點簡訊連結",
          "不要輸入信用卡",
          "回官方物流App查詢"
        ],
        "scammer": [
          "阿盾老師問你：你最近剛好有網購，今天收到一封包裹簡訊。",
          "簡訊寫著：「地址異常無法配送，請補繳 30 元運費重新安排。」",
          "你心想才 30 元而已，不趕快繳包裹退回去更麻煩。這時你會點連結輸入信用卡嗎？"
        ],
        "riskyFollowups": [
          "只是30元而已，請現在補繳避免退貨。"
        ],
        "coachSafe": "很好。小額補繳也可能是釣魚網站，不能輸入信用卡資料。",
        "coachRisky": "這個回覆仍有風險。包裹補繳、限時、信用卡資料是常見詐騙組合。"
      },
      {
        "id": "lesson4_wrong_address",
        "title": "如果是你，你會怎麼做？",
        "category": "假包裹詐騙",
        "lesson": [
          "不要在陌生網頁填地址與電話",
          "確認是否真的有購物",
          "使用官方物流查詢"
        ],
        "scammer": [
          "阿盾老師問你：你收到物流通知，說你的收件地址不完整。",
          "通知要求你點連結，重新填姓名、電話和地址，否則包裹會被退回。",
          "你真的有買東西，所以覺得很像真的。這時你會直接填資料嗎？"
        ],
        "riskyFollowups": [
          "請先填完整資料，我們才能安排配送。"
        ],
        "coachSafe": "做得好。物流資訊要回官方管道查，不要在陌生頁面填資料。",
        "coachRisky": "這個回覆仍要小心。陌生連結要求填個資，可能是釣魚詐騙。"
      },
      {
        "id": "lesson4_customs_fee",
        "title": "如果是你，你會怎麼做？",
        "category": "假包裹詐騙",
        "lesson": [
          "關稅通知要查官方管道",
          "不要點陌生付款連結",
          "不要輸入信用卡背面三碼"
        ],
        "scammer": [
          "阿盾老師問你：你收到通知說海外包裹卡在海關，需要補繳關稅。",
          "連結打開後要求你輸入信用卡號、有效期限和背面三碼。",
          "你最近剛好有買國外商品，覺得可能是真的。這時你會付款嗎？"
        ],
        "riskyFollowups": [
          "未繳關稅將退運，請立即刷卡。"
        ],
        "coachSafe": "很好。關稅與物流問題要回官方平台或物流公司查詢。",
        "coachRisky": "這個回覆有風險。信用卡號與背面三碼不能填在不明網站。"
      },
      {
        "id": "lesson4_delivery_call",
        "title": "如果是你，你會怎麼做？",
        "category": "假包裹詐騙",
        "lesson": [
          "電話通知也要查證",
          "不要照對方指示操作連結",
          "不要提供金融資料"
        ],
        "scammer": [
          "阿盾老師問你：你接到自稱物流人員的電話，說包裹地址錯誤。",
          "對方很客氣地說：「我傳一個連結給你，你補一下資料和小額運費就好。」",
          "你聽對方講得很像真的物流人員。這時你會照著連結操作嗎？"
        ],
        "riskyFollowups": [
          "我現在就幫你處理，不然包裹會退回。"
        ],
        "coachSafe": "做得好。就算是電話通知，也要回官方物流查詢，不要照陌生連結操作。",
        "coachRisky": "這個回覆仍有風險。電話加連結加付款，常是包裹詐騙套路。"
      }
    ]
  },
  {
    "id": "fake_customer_service",
    "title": "第五課：假客服／解除分期詐騙",
    "desc": "用生活故事練習辨識假客服來電、誤設分期、要求操作 ATM 或網銀。",
    "tag": "假客服詐騙",
    "src": "../assets/videos/lesson5-fake-customer-service.mp4",
    "note": "第5支影片放入後會自動播放；目前若影片讀不到，系統會先開放故事互動。",
    "scenarios": [
      {
        "id": "lesson5_atm_cancel",
        "title": "如果是你，你會怎麼做？",
        "category": "假客服詐騙",
        "lesson": [
          "ATM不能解除分期",
          "不要照電話指示操作",
          "掛電話後打官方客服查證"
        ],
        "scammer": [
          "阿盾老師問你：你正在吃晚餐，突然接到一通自稱購物平台客服的電話。",
          "對方說：「系統出錯，把你的訂單弄成每個月扣款，不處理會連扣 12 個月。」",
          "對方叫你馬上帶提款卡去 ATM，他會一步一步教你取消。這時你會照做嗎？"
        ],
        "riskyFollowups": [
          "請不要掛電話，現在去ATM才來得及取消。"
        ],
        "coachSafe": "很好。ATM不能解除分期，接到這種電話要掛掉並查官方客服。",
        "coachRisky": "這個回覆很危險。假客服常用「誤設分期」騙你操作ATM或網銀。"
      },
      {
        "id": "lesson5_bank_staff",
        "title": "如果是你，你會怎麼做？",
        "category": "假客服詐騙",
        "lesson": [
          "不要照陌生來電操作網銀",
          "不要提供帳號密碼或驗證碼",
          "打銀行官方電話確認"
        ],
        "scammer": [
          "阿盾老師問你：你接到自稱銀行安全中心的電話，對方說你的帳戶出現異常扣款。",
          "對方要求你立刻登入網銀，並說等一下收到驗證碼也要唸給他確認。",
          "你聽到帳戶異常很緊張。這時你會照他的指示操作嗎？"
        ],
        "riskyFollowups": [
          "這是安全流程，請把驗證碼唸給我。"
        ],
        "coachSafe": "做得好。銀行不會要求你把驗證碼唸給客服。",
        "coachRisky": "這個回覆仍有風險。網銀、驗證碼、電話指示操作，是高度危險警訊。"
      },
      {
        "id": "lesson5_refund",
        "title": "如果是你，你會怎麼做？",
        "category": "假客服詐騙",
        "lesson": [
          "退款不需要操作ATM",
          "不要提供金融卡資料",
          "回官方平台查訂單"
        ],
        "scammer": [
          "阿盾老師問你：你接到一通電話，對方說你之前買的商品要退款。",
          "對方說：「退款流程比較特殊，需要你到 ATM 做身分確認，錢才會退回去。」",
          "你聽到可以退款，覺得不拿白不拿。這時你會去 ATM 操作嗎？"
        ],
        "riskyFollowups": [
          "這是退款身分確認，不會扣你的錢。"
        ],
        "coachSafe": "很好。退款不需要到 ATM 操作，應回官方平台查詢。",
        "coachRisky": "這個回覆有風險。ATM 不能退款確認，照指示操作可能把錢轉出去。"
      },
      {
        "id": "lesson5_police_bank",
        "title": "如果是你，你會怎麼做？",
        "category": "假客服詐騙",
        "lesson": [
          "警察或銀行不會要求監管帳戶",
          "不要匯款保管資金",
          "遇到恐嚇壓力先掛電話打165"
        ],
        "scammer": [
          "阿盾老師問你：你接到電話，對方說你的帳戶涉及洗錢案件。",
          "他自稱可以幫你處理，但要求你先把錢轉到「安全帳戶」保管，不然帳戶會被凍結。",
          "你聽到可能犯法，很害怕。這時你會把錢轉出去嗎？"
        ],
        "riskyFollowups": [
          "不配合就會被凍結帳戶，請立刻轉到安全帳戶。"
        ],
        "coachSafe": "做得好。沒有「安全帳戶」這種做法，遇到恐嚇要先掛電話並打165。",
        "coachRisky": "這個回覆非常危險。要求轉到安全帳戶，是典型詐騙話術。"
      }
    ]
  }
];

  const state = {
    scenarios: [],
    current: null,
    chatHistory: [],
    recentIds: [],
    isSending: false,
    hasUserAnswered: false,
    timers: [],
    coachFailSafeTimer: null,
    lessonIndex: 0,
    questionIndex: 0,
    practiceUnlocked: false,
    watchedLessons: {},
    mode: 'course',
    challengeQueue: [],
    challengeIndex: 0,
    challengeResults: []
  };

  function $(id) {
    return document.getElementById(id);
  }

  const els = {};

  function cacheDom() {
    Object.entries(DOM_IDS).forEach(([key, id]) => {
      els[key] = $(id);
    });
  }

  function clearTimers() {
    state.timers.forEach((timer) => clearTimeout(timer));
    state.timers = [];
    if (state.coachFailSafeTimer) {
      clearTimeout(state.coachFailSafeTimer);
      state.coachFailSafeTimer = null;
    }
  }

  function addTimer(fn, delay) {
    const timer = setTimeout(fn, delay);
    state.timers.push(timer);
    return timer;
  }

  function normalizeText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function sanitizeClassroomText(text) {
    return String(text || '')
      // 防詐教室給 50+ 長輩使用，避免骷髏、死亡、恐怖符號造成壓迫感。
      .replace(/[💀☠️☠]/g, '提醒')
      .replace(/骷髏頭?/g, '警示圖示')
      .replace(/死亡|死掉|恐怖|嚇人/g, '高風險')
      .replace(/血腥|鬼|惡魔/g, '警示');
  }

  function segmentText(text) {
    return String(text || '')
      .split(/[，,。.!！?？；;、\n\s]+/)
      .map((part) => normalizeText(part))
      .filter(Boolean);
  }

  function levenshtein(a, b) {
    const s = normalizeText(a);
    const t = normalizeText(b);
    if (s === t) return 0;
    if (!s) return t.length;
    if (!t) return s.length;

    const rows = s.length + 1;
    const cols = t.length + 1;
    const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));

    for (let i = 0; i < rows; i += 1) dp[i][0] = i;
    for (let j = 0; j < cols; j += 1) dp[0][j] = j;

    for (let i = 1; i < rows; i += 1) {
      for (let j = 1; j < cols; j += 1) {
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }

    return dp[s.length][t.length];
  }

  function containsTerm(text, term) {
    const value = normalizeText(text);
    const target = normalizeText(term);
    if (!value || !target) return false;
    if (value.includes(target)) return true;

    // 針對短句錯字容錯：例如「不會款」接近「不匯款」。
    if (target.length >= 3 && value.length <= 40) {
      const windows = [];
      for (let i = 0; i <= Math.max(0, value.length - target.length); i += 1) {
        windows.push(value.slice(i, i + target.length));
      }
      return windows.some((part) => levenshtein(part, target) <= 1);
    }

    return false;
  }

  function hasNearbyNegation(rawText, term) {
    const value = normalizeText(rawText);
    const target = normalizeText(term);
    const idx = value.indexOf(target);
    if (idx < 0) return false;

    const before = value.slice(Math.max(0, idx - 8), idx + target.length);
    return NEGATION_TERMS.some((neg) => before.includes(normalizeText(neg)));
  }

  function evaluateUserReply(text) {
    const normalized = normalizeText(text);
    const clauses = segmentText(text);
    let score = CLASSROOM_CONFIG.score.base;
    const reasons = [];
    const safeHits = [];
    const riskyHits = [];

    for (const rule of SAFE_RULES) {
      const matched = rule.terms.some((term) => containsTerm(normalized, term));
      if (matched) {
        score += rule.weight;
        safeHits.push(rule.label);
        reasons.push(`安全行為：${rule.label}`);
      }
    }

    for (const rule of RISKY_RULES) {
      const matchedTerms = rule.terms.filter((term) => containsTerm(normalized, term));
      if (!matchedTerms.length) continue;

      const allNegated = matchedTerms.every((term) => hasNearbyNegation(text, term));
      if (allNegated) {
        score += CLASSROOM_CONFIG.score.safeWeak;
        safeHits.push(`拒絕${rule.label.replace('仍可能', '')}`);
        reasons.push(`安全行為：有提到「${matchedTerms[0]}」，但語意是拒絕或不提供。`);
      } else {
        score += rule.weight;
        riskyHits.push(rule.label);
        reasons.push(`風險線索：${rule.label}`);
      }
    }

    const hasSafe = safeHits.length > 0;
    const hasRisk = riskyHits.length > 0;

    // 混合語句不能直接判安全，例如：「我不提供密碼，但你可以把匯款帳號給我」。
    if (hasSafe && hasRisk) {
      score += CLASSROOM_CONFIG.score.conflictPenalty;
      reasons.push('注意：你的回覆同時有安全行為與危險行為，AI 判定仍需小心。');
    }

    // 完全沒有明確安全動作時，不給高分。
    if (!hasSafe && clauses.length > 0) {
      score -= 8;
      reasons.push('建議：請明確說出「我不提供資料、我要查證或問家人」。');
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    let label = '需要再小心';
    let status = 'caution';
    if (score >= CLASSROOM_CONFIG.thresholds.safe && hasSafe && !hasRisk) {
      label = '安全做法';
      status = 'safe';
    } else if (score < CLASSROOM_CONFIG.thresholds.caution || hasRisk) {
      label = '請先停一下';
      status = 'risky';
    }

    return {
      score,
      label,
      status,
      reasons: reasons.length ? Array.from(new Set(reasons)).slice(0, 5) : ['AI 還沒有看到明確的拒絕、查證或求助行為。'],
      hasSafe,
      hasRisk
    };
  }

  function getBuiltInFallbackScenarios() {
    return [
      {
        id: 'builtin_parcel_fee',
        title: '包裹補繳運費詐騙',
        category: '物流詐騙',
        lesson: ['先停下來', '不要點陌生連結', '回官方 App 或 165 查證'],
        scammer: [
          '您好，您的包裹因地址異常無法配送。',
          '請在 10 分鐘內補繳 32 元運費，否則包裹會被退回。',
          '請點擊連結並輸入信用卡資料完成重新配送。'
        ],
        riskyFollowups: ['時間快到了，請你現在先輸入信用卡資料。'],
        coachSafe: '做得好。你沒有直接點連結，而是選擇查證官方來源。',
        coachRisky: '這個回覆仍有風險。包裹補繳、信用卡與限時壓力常一起出現在釣魚詐騙。'
      },
      {
        id: 'builtin_investment_line',
        title: '假投資老師邀請',
        category: '投資詐騙',
        lesson: ['保證獲利就是警訊', '不要加入陌生投資群', '不要轉帳或下載不明 App'],
        scammer: [
          '老師今天開放 VIP 名額，這支飆股明天會漲。',
          '名額有限，現在加入 LINE 群組就能跟單。',
          '先入金一小筆，老師會帶你操作。'
        ],
        riskyFollowups: ['先入金卡位，不然名額就沒有了。'],
        coachSafe: '很好。你有避開陌生投資群與保證獲利話術。',
        coachRisky: '這個回覆仍有風險。老師帶單、VIP、保證獲利與入金都是高風險組合。'
      }
    ];
  }

  function getScenarioPool() {
    const richPool = Array.isArray(window.aiShieldClassroomScenarios) ? window.aiShieldClassroomScenarios : [];
    if (richPool.length) return richPool;

    const legacyPool = Array.isArray(window.allScenarios) ? window.allScenarios : [];
    const normalizedLegacyPool = legacyPool.map((steps, index) => ({
      id: `legacy_${index}`,
      title: `防詐情境 ${index + 1}`,
      category: '防詐演練',
      lesson: ['先停下來', '不要提供資料', '查證後再決定'],
      scammer: steps.filter((step) => step.role === 'scammer').map((step) => step.text).filter(Boolean),
      safeReplies: steps.filter((step) => step.role === 'victim').map((step) => step.text).filter(Boolean),
      riskyFollowups: ['時間不多了，請你現在照我說的做。'],
      coachSafe: steps.find((step) => step.role === 'system')?.text || '做得好，先停下來查證。',
      coachRisky: '這個回覆仍有風險，請先拒絕、查證或問家人。'
    })).filter((item) => item.scammer.length);

    return normalizedLegacyPool.length ? normalizedLegacyPool : getBuiltInFallbackScenarios();
  }

  function pickRandomScenario() {
    const pool = state.scenarios;
    if (!pool.length) return null;

    const available = pool.filter((scenario) => !state.recentIds.includes(scenario.id));
    const source = available.length ? available : pool;
    const scenario = source[Math.floor(Math.random() * source.length)];

    state.recentIds.push(scenario.id);
    if (state.recentIds.length > CLASSROOM_CONFIG.maxRecentScenarioIds) {
      state.recentIds.shift();
    }

    return scenario;
  }

  function setSending(isSending) {
    state.isSending = isSending;
    if (els.send) {
      els.send.disabled = isSending;
      els.send.textContent = isSending ? '判斷中...' : '送出';
    }
    if (els.input) els.input.disabled = isSending;
  }

  function setScoreView(result) {
    if (!result) {
      if (els.scoreNum) els.scoreNum.textContent = '';
      if (els.scoreLabel) els.scoreLabel.textContent = '先看題目，再選擇你的做法。';
      if (els.scoreIcon) {
        /* 保留阿盾老師圖片，不用文字 */
        els.scoreIcon.className = 'score-icon';
      }
      if (els.scoreBar) {
        els.scoreBar.style.width = '50%';
        els.scoreBar.style.background = '#2477f2';
      }
      renderList(els.reasons, ['選擇做法後，阿盾老師會提醒你哪裡安全、哪裡危險。']);
      return;
    }

    if (els.scoreNum) els.scoreNum.textContent = '';
    if (els.scoreLabel) els.scoreLabel.textContent = result.status === 'safe' ? '你的做法很安全。' : result.status === 'risky' ? '這個做法有風險，請先停一下。' : '這個做法還可以更安全。';
    if (els.scoreIcon) {
      els.scoreIcon.className = `score-icon ${result.status || ''}`.trim();
      // 保留阿盾老師圖片，不用 textContent 覆蓋 <img>。
    }
    if (els.scoreBar) { els.scoreBar.style.width = '0%'; }
    renderList(els.reasons, result.reasons);

    if (els.coachDetail) els.coachDetail.open = true;
  }

  function renderList(container, items) {
    if (!container) return;
    container.replaceChildren();
    (items || []).forEach((text) => {
      const li = document.createElement('li');
      li.textContent = sanitizeClassroomText(text);
      container.appendChild(li);
    });
  }

  function renderScenarioHeader() {
    const scenario = state.current;
    if (!scenario) return;

    if (els.title) els.title.textContent = sanitizeClassroomText(scenario.title || '防詐情境');
    if (els.meta) {
      els.meta.replaceChildren();
      [scenario.category || '防詐演練', '隨機情境', 'AI 教練判斷'].forEach((text) => {
        const span = document.createElement('span');
        span.className = 'pill';
        span.textContent = sanitizeClassroomText(text);
        els.meta.appendChild(span);
      });
    }
    renderList(els.lessons, scenario.lesson || ['先停下來', '不要提供資料', '查證後再決定']);
  }

  function appendMessage(type, text, options = {}) {
    if (!els.chat) return null;
    const div = document.createElement('div');
    const className = type === 'user' ? 'user-msg' : type === 'coach' ? 'coach-msg' : type === 'system' ? 'system-msg' : 'scammer-msg';
    div.className = `message ${className}`;
    if (options.typing) div.classList.add('typing');
    if (options.summary) div.classList.add('challenge-summary');
    div.textContent = sanitizeClassroomText(text);
    els.chat.appendChild(div);
    els.chat.scrollTop = els.chat.scrollHeight;
    return div;
  }

  function renderScenarioMessages() {
    if (!els.chat || !state.current) return;
    els.chat.replaceChildren();
    const messages = state.current.scammer || [];
    const visibleMessages = messages.slice(0, 3);

    // 故事還沒講完前，先鎖住輸入，避免長輩太快送出造成對話順序混亂。
    setSending(true);
    if (els.send) els.send.textContent = '故事出現中...';

    visibleMessages.forEach((text, index) => {
      addTimer(() => appendMessage('scammer', text), index * CLASSROOM_CONFIG.typingDelayMs);
    });

    const totalTypingTime = Math.max(visibleMessages.length, 1) * CLASSROOM_CONFIG.typingDelayMs;
    addTimer(() => {
      setSending(false);
      if (els.send) {
        els.send.textContent = state.practiceUnlocked ? '送出' : '請先看完影片';
      }
      if (state.practiceUnlocked && els.input) els.input.focus();
    }, totalTypingTime);
  }



  function getCurrentLesson() {
    return VIDEO_LESSONS[state.lessonIndex] || VIDEO_LESSONS[0];
  }

  function getCurrentLessonScenario() {
    const lesson = getCurrentLesson();
    return lesson?.scenarios?.[state.questionIndex] || lesson?.scenarios?.[0] || null;
  }


  function getAllLessonScenarios() {
    return VIDEO_LESSONS.flatMap((lesson, lessonIndex) =>
      (lesson.scenarios || []).map((scenario, questionIndex) => ({
        ...scenario,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        lessonIndex,
        questionIndex
      }))
    );
  }

  function shuffleArray(items) {
    const list = items.slice();
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  function getCurrentChallengeScenario() {
    return state.challengeQueue[state.challengeIndex] || state.challengeQueue[0] || null;
  }

  function updateModeButtons() {
    if (els.modeCourse) els.modeCourse.classList.toggle('active', state.mode === 'course');
    if (els.modeChallenge) els.modeChallenge.classList.toggle('active', state.mode === 'challenge');
  }

  function setMode(mode) {
    state.mode = mode === 'challenge' ? 'challenge' : 'course';
    updateModeButtons();

    if (els.lessonVideoCard) {
      els.lessonVideoCard.classList.toggle('hidden', state.mode === 'challenge');
    }
    if (els.startPractice) {
      els.startPractice.textContent = state.mode === 'challenge' ? '挑戰進行中' : (state.practiceUnlocked ? '換你回答中' : '換你判斷');
    }
    if (els.next) {
      els.next.textContent = state.mode === 'challenge' ? '下一題挑戰' : '下一個情境';
    }
    if (els.restart) {
      els.restart.textContent = '重看這題';
    }
  }

  function startCourseMode() {
    setMode('course');
    startScenario(getCurrentLessonScenario());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startChallengeMode() {
    const allScenarios = getAllLessonScenarios();
    state.challengeQueue = shuffleArray(allScenarios).slice(0, 5);
    state.challengeIndex = 0;
    state.challengeResults = [];
    setMode('challenge');
    setPracticeUnlocked(true);
    startScenario(getCurrentChallengeScenario());
    appendMessage('system', '🎲 防詐挑戰開始！這次會從 20 題裡隨機抽出 5 題，不看影片，直接練習判斷。');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function recordChallengeResult(result) {
    if (state.mode !== 'challenge' || !state.current || !result) return;
    state.challengeResults[state.challengeIndex] = {
      score: result.score,
      status: result.status,
      category: state.current.category || '防詐演練',
      title: state.current.title || '防詐情境'
    };
  }

  function buildChallengeReport() {
    const results = state.challengeResults.filter(Boolean);
    if (!results.length) return '還沒有完成挑戰題目。';

    const avg = Math.round(results.reduce((sum, item) => sum + item.score, 0) / results.length);
    const weak = results
      .filter((item) => item.score < CLASSROOM_CONFIG.thresholds.safe || item.status !== 'safe')
      .reduce((map, item) => {
        map[item.category] = (map[item.category] || 0) + 1;
        return map;
      }, {});
    const weakCategories = Object.entries(weak)
      .sort((a, b) => b[1] - a[1])
      .map(([category]) => category)
      .slice(0, 2);

    const level = avg >= 85 ? '優秀' : avg >= 72 ? '穩定' : avg >= 55 ? '需要多練習' : '高風險，建議重新複習';
    const weakText = weakCategories.length ? weakCategories.map((name, index) => `${index + 1}. ${name}`).join('\n') : '目前沒有明顯弱項，表現很穩。';
    const reviewText = weakCategories.length ? `

建議複習：${weakCategories.join('、')}` : '';

    return `🛡️ 防詐能力報告

完成題數：${results.length} / 5
平均分數：${avg} 分
判斷能力：${level}

較需要留意的類型：
${weakText}${reviewText}`;
  }

  function finishChallenge() {
    appendMessage('system', buildChallengeReport(), { summary: true });
    if (els.next) els.next.textContent = '重新挑戰';
    if (els.restart) els.restart.textContent = '重抽挑戰';
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  function setPracticeUnlocked(unlocked) {
    state.practiceUnlocked = Boolean(unlocked);
    if (els.practiceArea) {
      els.practiceArea.classList.toggle('lesson-lock', !state.practiceUnlocked);
    }
    if (els.startPractice) {
      els.startPractice.disabled = false;
      els.startPractice.textContent = state.mode === 'challenge'
        ? '挑戰進行中'
        : (state.practiceUnlocked ? '換你回答中' : '換你判斷');
    }
    if (els.send && !state.isSending) {
      els.send.textContent = state.practiceUnlocked ? '送出' : '請先看完影片';
    }
    if (state.practiceUnlocked && els.input) els.input.focus();
  }

  function renderVideoLesson() {
    const lesson = getCurrentLesson();
    if (!lesson || !els.lessonVideoCard) return;

    if (els.lessonVideoTitle) els.lessonVideoTitle.textContent = lesson.title;
    if (els.lessonVideoDesc) els.lessonVideoDesc.textContent = lesson.desc;
    if (els.lessonVideoTag) els.lessonVideoTag.textContent = lesson.tag || '影片教材';
    if (els.lessonVideoNote) els.lessonVideoNote.textContent = lesson.note || '看完影片後，按「開始互動練習」。';
    if (els.lessonProgress) {
      els.lessonProgress.textContent = `第 ${state.lessonIndex + 1} 課 / 共 ${VIDEO_LESSONS.length} 課　｜　第 ${state.questionIndex + 1} 題 / 共 ${lesson.scenarios.length} 題`;
    }

    if (els.lessonVideoPlayer && els.lessonVideoSource) {
      if (lesson.src) {
        els.lessonVideoSource.src = lesson.src;
        els.lessonVideoPlayer.load();
      } else {
        els.lessonVideoSource.removeAttribute('src');
        els.lessonVideoPlayer.load();
      }
    }

    setPracticeUnlocked(Boolean(state.watchedLessons[lesson.id]) || !lesson.src);
  }

  function unlockPracticeFromVideo() {
    // 避免影片 ended 事件和「開始互動練習」按鈕同時觸發，造成提示重複出現。
    if (state.practiceUnlocked) return;
    const lesson = getCurrentLesson();
    if (lesson) state.watchedLessons[lesson.id] = true;
    setPracticeUnlocked(true);
    appendMessage('system', '影片看完了！現在請依照剛才的情境，告訴阿盾老師你會怎麼做。');
  }

  function handleVideoError() {
    if (state.practiceUnlocked) return;
    const lesson = getCurrentLesson();
    if (els.lessonVideoNote) {
      els.lessonVideoNote.textContent = '影片暫時讀不到，已先開放互動練習。請確認影片是否放在 assets/videos。';
    }
    if (lesson) state.watchedLessons[lesson.id] = true;
    setPracticeUnlocked(true);
    appendMessage('system', '影片暫時無法載入，已先開放互動練習。');
  }

  function startScenario(scenario) {
    clearTimers();
    state.current = scenario || (state.mode === 'challenge' ? getCurrentChallengeScenario() : getCurrentLessonScenario());
    state.chatHistory = [];
    state.hasUserAnswered = false;
    setSending(false);
    setScoreView(null);
    updateModeButtons();
    if (window.matchMedia('(max-width: 850px)').matches) {
      if (els.coachDetail) els.coachDetail.open = false;
      if (els.lessonDetail) els.lessonDetail.open = true;
    }
    renderScenarioHeader();
    if (state.mode === 'challenge') {
      if (els.lessonVideoCard) els.lessonVideoCard.classList.add('hidden');
      setPracticeUnlocked(true);
      if (els.title && state.current) {
        els.title.textContent = `🎲 防詐挑戰 ${state.challengeIndex + 1} / ${Math.max(state.challengeQueue.length, 5)}｜${sanitizeClassroomText(state.current.title || '防詐情境')}`;
      }
    } else {
      if (els.lessonVideoCard) els.lessonVideoCard.classList.remove('hidden');
      renderVideoLesson();
    }
    renderScenarioMessages();
    if (els.input) {
      els.input.value = '';
    }
  }

  function buildCoachReply(result, userText) {
    const scenario = state.current || {};
    if (result.status === 'safe') {
      return sanitizeClassroomText(`${scenario.coachSafe || '做得好，你先停下來查證，這樣很安全。'}\n\nAI 提醒：${result.label}`);
    }

    if (result.status === 'risky') {
      const nextPressure = scenario.riskyFollowups?.[0] ? `\n\n對方可能會繼續說：「${scenario.riskyFollowups[0]}」` : '';
      return sanitizeClassroomText(`${scenario.coachRisky || '這個回覆還要再小心。先不要點連結、不要給資料，也不要匯款。'}${nextPressure}\n\nAI 提醒：${result.label}`);
    }

    return sanitizeClassroomText(`你已經有警覺了。可以更直接說：「我不提供資料，我要先查證或問家人。」\n\nAI 提醒：${result.label}`);
  }

  function clearCoachFailSafe() {
    if (!state.coachFailSafeTimer) return;
    clearTimeout(state.coachFailSafeTimer);
    state.coachFailSafeTimer = null;
  }

  function startCoachFailSafe(typingBubble) {
    clearCoachFailSafe();
    state.coachFailSafeTimer = setTimeout(() => {
      if (!state.isSending) return;
      if (typingBubble) {
        typingBubble.classList.remove('typing');
        typingBubble.textContent = CLASSROOM_CONFIG.defaultSafetyReply;
      } else {
        appendMessage('coach', CLASSROOM_CONFIG.defaultSafetyReply);
      }
      state.chatHistory.push({ role: 'assistant', content: CLASSROOM_CONFIG.defaultSafetyReply });
      setScoreView({
        score: CLASSROOM_CONFIG.thresholds.caution,
        label: '啟用備援提醒',
        status: 'caution',
        reasons: ['AI 教練回覆逾時，已啟用預設防詐提醒。'],
        hasSafe: false,
        hasRisk: false
      });
      setSending(false);
      
    }, CLASSROOM_CONFIG.demoFailSafeTimeoutMs);
  }

  function submitUserReply(replyText) {
    if (state.isSending || !state.current) return;
    if (!state.practiceUnlocked) {
      appendMessage('system', '請先觀看影片教材，或按「換你判斷」。');
      return;
    }
    const text = String(replyText || els.input?.value || '').trim();
    if (!text) {
      appendMessage('coach', '請先輸入你的回應。可以試著說：「我不提供資料，我要先查證。」');
      return;
    }

    const alreadyAnswered = state.hasUserAnswered;
    state.hasUserAnswered = true;
    appendMessage('user', `我：${text}`);
    state.chatHistory.push({ role: 'user', content: text });
    if (els.input) els.input.value = '';

    let result;
    try {
      result = evaluateUserReply(text);
      setScoreView(result);
      if (state.mode === 'challenge' && !alreadyAnswered) recordChallengeResult(result);
    } catch (error) {
      console.warn('AI 教練本機評分失敗，啟用備援提醒：', error);
      result = {
        score: CLASSROOM_CONFIG.thresholds.caution,
        label: '啟用備援提醒',
        status: 'caution',
        reasons: ['本機評分暫時失敗，已改用固定防詐提醒。'],
        hasSafe: false,
        hasRisk: false
      };
      setScoreView(result);
    }

    setSending(true);

    const typingBubble = appendMessage('coach', 'AI 教練正在判斷...', { typing: true });
    startCoachFailSafe(typingBubble);

    addTimer(() => {
      try {
        clearCoachFailSafe();
        const reply = buildCoachReply(result, text) || CLASSROOM_CONFIG.defaultSafetyReply;
        if (typingBubble) {
          typingBubble.classList.remove('typing');
          typingBubble.textContent = reply;
        }
        state.chatHistory.push({ role: 'assistant', content: typingBubble?.textContent || reply });
      } catch (error) {
        console.warn('AI 教練回覆生成失敗，啟用預設提醒：', error);
        if (typingBubble) {
          typingBubble.classList.remove('typing');
          typingBubble.textContent = CLASSROOM_CONFIG.defaultSafetyReply;
        }
        state.chatHistory.push({ role: 'assistant', content: CLASSROOM_CONFIG.defaultSafetyReply });
      } finally {
        clearCoachFailSafe();
        setSending(false);
        
      }
    }, CLASSROOM_CONFIG.coachDelayMs);
  }



  let speechRecognition = null;
  let isVoiceListening = false;

  function getSpeechRecognitionConstructor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function setVoiceButtonState(stateName, label) {
    if (!els.voice) return;
    els.voice.classList.toggle('listening', stateName === 'listening');
    els.voice.classList.toggle('unsupported', stateName === 'unsupported');
    els.voice.setAttribute('aria-pressed', stateName === 'listening' ? 'true' : 'false');
    els.voice.textContent = label;
  }

  function setupVoiceInput() {
    if (!els.voice) return;

    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      setVoiceButtonState('unsupported', '🎙️ 不支援');
      els.voice.disabled = true;
      els.voice.title = '此瀏覽器不支援語音輸入，可改用快速回應按鈕。';
      return;
    }

    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = 'zh-TW';
    speechRecognition.interimResults = true;
    speechRecognition.continuous = false;

    speechRecognition.onstart = () => {
      isVoiceListening = true;
      setVoiceButtonState('listening', '正在聽...');
    };

    speechRecognition.onend = () => {
      isVoiceListening = false;
      setVoiceButtonState('', '🎙️ 語音');
    };

    speechRecognition.onerror = () => {
      isVoiceListening = false;
      setVoiceButtonState('', '🎙️ 語音');
      appendMessage('system', '語音輸入暫時沒有聽清楚，也可以直接點上方安全回應。');
    };

    speechRecognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || '')
        .join('')
        .trim();

      if (els.input && transcript) {
        els.input.value = transcript;
      }
    };

    els.voice.addEventListener('click', () => {
      try {
        if (isVoiceListening) {
          speechRecognition.stop();
          return;
        }
        speechRecognition.start();
      } catch (error) {
        console.warn('語音輸入啟動失敗：', error);
        appendMessage('system', '語音輸入暫時無法啟動，可以使用快速回應按鈕。');
      }
    });
  }


  function bindEvents() {
    setMode('course');
    if (els.send) els.send.addEventListener('click', () => submitUserReply());
    if (els.input) {
      els.input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          submitUserReply();
        }
      });
    }
    if (els.modeCourse) els.modeCourse.addEventListener('click', startCourseMode);
    if (els.modeChallenge) els.modeChallenge.addEventListener('click', startChallengeMode);
    if (els.next) els.next.addEventListener('click', () => {
      if (state.mode === 'challenge') {
        if (els.next.textContent === '重新挑戰') {
          startChallengeMode();
          return;
        }
        if (!state.hasUserAnswered) {
          appendMessage('system', '先回答這一題，再進入下一題挑戰。');
          return;
        }
        if (state.challengeIndex < state.challengeQueue.length - 1) {
          state.challengeIndex += 1;
          startScenario(getCurrentChallengeScenario());
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        finishChallenge();
        return;
      }

      const lesson = getCurrentLesson();
      if (lesson && state.questionIndex < lesson.scenarios.length - 1) {
        state.questionIndex += 1;
      } else if (state.lessonIndex < VIDEO_LESSONS.length - 1) {
        state.lessonIndex += 1;
        state.questionIndex = 0;
      } else {
        appendMessage('system', '恭喜完成 5 課防詐練習！可以按「重來」複習本題，或重新整理再練一次。');
        return;
      }
      startScenario(getCurrentLessonScenario());
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    if (els.restart) els.restart.addEventListener('click', () => {
      if (state.mode === 'challenge') {
        if (els.restart.textContent === '重抽挑戰') {
          startChallengeMode();
        } else {
          startScenario(state.current);
        }
      } else {
        startScenario(state.current);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    if (els.startPractice) els.startPractice.addEventListener('click', unlockPracticeFromVideo);
    if (els.lessonVideoPlayer) {
      els.lessonVideoPlayer.addEventListener('ended', unlockPracticeFromVideo);
      els.lessonVideoPlayer.addEventListener('error', handleVideoError);
    }
    if (els.quickVerify) els.quickVerify.addEventListener('click', () => submitUserReply(SAFE_QUICK_REPLIES.verify));
    if (els.quickFamily) els.quickFamily.addEventListener('click', () => submitUserReply(SAFE_QUICK_REPLIES.family));
    if (els.quickRefuse) els.quickRefuse.addEventListener('click', () => submitUserReply(SAFE_QUICK_REPLIES.refuse));
    if (els.quickRisky) els.quickRisky.addEventListener('click', () => submitUserReply(SAFE_QUICK_REPLIES.risk));
    /* 長輩智慧版不使用語音輸入 */
  }

  function init() {
    cacheDom();

    if (!els.chat || !els.input || !els.send) {
      console.error('AI 防詐教室缺少必要 DOM，請確認 simulator.html 已更新為正式版。');
      return;
    }

    state.scenarios = getScenarioPool();
    if (!state.scenarios.length) {
      appendMessage('system', '目前找不到防詐劇本，請確認 scenarios.js 已放在同一個資料夾。');
      return;
    }

    bindEvents();
    startCourseMode();
    console.log('🛡️ AI 防詐教室已啟動', { scenarioCount: state.scenarios.length });
  }

  function safeInit() {
    try {
      init();
    } catch (error) {
      console.error('AI 防詐教室初始化失敗，啟用靜態備援：', error);
      cacheDom();
      if (els.chat) {
        els.chat.replaceChildren();
        appendMessage('system', CLASSROOM_CONFIG.defaultSafetyReply);
      }
      setSending(false);
    }
  }

  window.addEventListener('online', () => appendMessage('system', '✅ 網路已恢復，防詐教室可繼續使用。'));
  window.addEventListener('offline', () => appendMessage('system', '目前網路不穩，但防詐教室會以本機模式繼續演練。'));

  document.addEventListener('DOMContentLoaded', safeInit, { once: true });
})();
