document.addEventListener('DOMContentLoaded', () => {
    const chatBox = document.getElementById('chat-box');
    const userInput = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const scenarioSelector = document.getElementById('scenario-selector');
    let chatHistory = [];

    // 初始化各情境的開場白
    const greetings = {
        'investment': "您好！我是李蜀芳老師的專屬助理。我們近期有內線飆股專案，名額有限，請問您有興趣了解嗎？",
        'ecommerce': "您好，這裡是XX購物網客服。很抱歉通知您，您的訂單因系統異常被設定為批發商，今晚12點將會連續扣款12個月，請問您需要協助取消嗎？",
        'romance': "親愛的，我寄給你的那個驚喜包裹目前卡在台灣海關了，物流公司說需要先繳納一筆通關保證金，你能先幫我墊付嗎？我回國馬上還你。"
    };

    function resetChat() {
        chatBox.innerHTML = '';
        chatHistory = [];
        const currentScenario = scenarioSelector.value;
        appendMessage('bot', greetings[currentScenario]);
    }

    // 監聽情境切換事件，一旦切換就重置對話
    scenarioSelector.addEventListener('change', resetChat);

    function appendMessage(sender, text) {
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', sender === 'user' ? 'user-msg' : 'bot-msg');
        msgDiv.innerText = text;
        chatBox.appendChild(msgDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    async function sendMessage() {
        const text = userInput.value.trim();
        if (!text) return;

        appendMessage('user', text);
        userInput.value = '';
        chatHistory.push({ role: "user", content: text });

        const loadingDiv = document.createElement('div');
        loadingDiv.classList.add('message', 'bot-msg');
        loadingDiv.innerText = "對方正在輸入中...";
        chatBox.appendChild(loadingDiv);
        chatBox.scrollTop = chatBox.scrollHeight;

        const currentScenario = scenarioSelector.value;

        try {
            const response = await fetch('http://127.0.0.1:5000/api/simulate_scam', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, history: chatHistory, scenario: currentScenario }) 
            });
            const data = await response.json();
            
            chatBox.removeChild(loadingDiv);
            appendMessage('bot', data.reply);
            chatHistory.push({ role: "assistant", content: data.reply });

        } catch (error) {
            chatBox.removeChild(loadingDiv);
            appendMessage('bot', "⚠️ 無法連線至防詐演練伺服器，請確認後端是否已啟動。");
            console.error(error);
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // 啟動時先載入預設對話
    resetChat();
});