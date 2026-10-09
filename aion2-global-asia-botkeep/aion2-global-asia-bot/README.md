# AION 2 Global Asia Discord Event Bot

Bot Discord thông báo 9 sự kiện Global Asia **trước 5 phút và đúng giờ** theo giờ Việt Nam (GMT+7).

## Nguồn và độ tin cậy
- Lịch tham khảo: https://shugo.gg/timers — UTC Global, dựa trên quan sát cộng đồng, **không phải lịch Asia chính thức**.
- Shugo.gg FAQ https://shugo.gg/faq nói không có public API được hỗ trợ. Bot **không scrape/tự lấy** Shugo.gg; `events.json` là nguồn dữ liệu chạy độc lập, có thể sửa khi kiểm chứng lịch trong game.
- **Dimensional Invasion** `:30` là lịch KR, chưa xác nhận Global Asia; đã bật theo yêu cầu, đánh dấu `provisional` trong Embed. Nếu không có sự kiện Global, xóa entry `invasion` trong `events.json` rồi restart.
- Lịch World Boss ở các nguồn cộng đồng có thể bất đồng; đối chiếu với giờ thực tế của server.

## Cài đặt trên Botkeep
1. Tạo Discord Application tại https://discord.com/developers/applications, tạo bot, lấy token. Mời bot với `bot` + `applications.commands`; cấp View Channel, Send Messages, Embed Links.
2. Upload **nội dung** thư mục này lên Botkeep (hoặc đẩy GitHub rồi import nếu dashboard hỗ trợ).
3. Chọn Node.js >=24.17 nếu có. Kiểm tra `package.json` và runtime trước khi chạy.
4. Sao chép `.env.example` thành `.env` rồi điền `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `CHANNEL_ID`; `ROLE_ID` tùy chọn. **Không chia sẻ token** và không commit `.env`.
5. Startup command `npm start`. Nếu host không tự cài package, chạy `npm install` một lần.
6. Trong Discord thử `/events`, `/nextboss`, `/testevent` (Manage Server).

## Hoạt động
- Scheduler kiểm tra mỗi 20 giây; thông báo trước 5 phút và lúc bắt đầu.
- Bỏ qua các mốc trễ trên 90 giây sau downtime.
- Chống gửi trùng bằng `sent-state.json`, ghi nguyên tử; giữ file qua restart/redeploy, chỉ chạy **một** instance.
- `events.json` lưu **ngày và giờ UTC** (`days`: 0=Chủ nhật, 1=Thứ hai ... 6=Thứ bảy). Tin nhắn hiển thị `Asia/Ho_Chi_Minh` và timestamp Discord.
- Khi sửa `events.json`, restart bot để áp dụng và kiểm tra JSON hợp lệ.
- Lịch Shugo Festival và Dimensional Invasion mỗi giờ sẽ tạo nhiều thông báo. Có thể xóa sự kiện không cần khỏi `events.json`.

## Cấu hình JSON
Các trường `id`, `name`, `days`, `times`, `durationMinutes`, `emoji`, `note`, `provisional`. Mỗi `id` phải duy nhất. `times` là mảng `HH:mm` UTC.

## Kiểm tra offline
`npm run check` xác nhận có đúng 9 sự kiện, định dạng JSON và quy đổi giờ.
