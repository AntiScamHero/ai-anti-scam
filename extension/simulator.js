document.addEventListener('DOMContentLoaded', () => {
    const chatBox = document.getElementById('chat-box');
    const userInput = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const scenarioSelector = document.getElementById('scenario-selector');
    let chatHistory = [];

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

        const msgDiv = document.createElement('div');
        msgDiv.classList.add('message', 'bot-msg');
        msgDiv.innerText = "對方正在輸入中...";
        chatBox.appendChild(msgDiv);
        chatBox.scrollTop = chatBox.scrollHeight;

        const currentScenario = scenarioSelector.value;

        try {
            const response = await fetch('https://ai-anti-scam.onrender.com/api/simulate_scam', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Extension-Secret': 'ai_shield_secure_2026' 
                },
                body: JSON.stringify({ message: text, history: chatHistory, scenario: currentScenario }) 
            });
            
            // 🚨 終極防呆：如果伺服器回傳 500 錯誤，直接攔截，防止 JSON.parse 當機
            if (!response.ok) {
                throw new Error(`伺服器狀態異常 (${response.status})：可能是 AI 模型尚未就緒或 API 金鑰失效。`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let aiReply = "";
            msgDiv.innerText = ""; 

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split("\n\n");

                for (let line of lines) {
                    if (line.startsWith("data: ")) {
                        const dataStr = line.replace("data: ", "");
                        if (dataStr === "[DONE]") break;
                        
                        try {
                            const parsed = JSON.parse(dataStr);
                            if (parsed.text) {
                                aiReply += parsed.text;
                                msgDiv.innerText = aiReply; 
                                chatBox.scrollTop = chatBox.scrollHeight;
                            }
                        } catch (e) {
                            console.error("解析串流資料發生錯誤:", e);
                        }
                    }
                }
            }
            chatHistory.push({ role: "assistant", content: aiReply });

        } catch (error) {
            // 優雅顯示錯誤，不會再出現滿江紅
            msgDiv.innerText = `⚠️ 演練伺服器連線失敗：${error.message}`;
            console.error(error);
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    resetChat();
});