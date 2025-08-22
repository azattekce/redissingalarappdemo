using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using StackExchange.Redis;
using System.Threading.Tasks;
using RedisChatApp.Data;
using RedisChatApp.Models;
using System.Linq;

namespace RedisChatApp.Hubs
{
    [Authorize]
    public class ChatHub : Hub
    {
        private readonly ILogger<ChatHub> _logger;
        private readonly AppDbContext _db;
    private readonly IConnectionMultiplexer _redis;

        public ChatHub(IConnectionMultiplexer redis, ILogger<ChatHub> logger, AppDbContext db)
        {
            _redis = redis;
            _logger = logger;
            _db = db;
        }

        public async Task SendMessage(string user, string message)
        {
            try
            {
                var pub = _redis.GetSubscriber();
                // Mesajı Redis kanalına publish et
                await pub.PublishAsync(RedisChannel.Literal("chat_channel"), $"{user}: {message}");
            }
            catch (RedisConnectionException ex)
            {
                _logger.LogError(ex, "Redis publish sırasında bağlantı hatası");
                throw; // istemci hatayı görsün
            }
        }

        // Özel mesaj: hedef kullanıcı ID'sine göre publish
        public async Task SendPrivateMessage(string toUserId, string message)
        {
            try
            {
                var fromUserId = Context.UserIdentifier ?? Context.User?.Identity?.Name ?? "";
                if (string.IsNullOrWhiteSpace(fromUserId) || string.IsNullOrWhiteSpace(toUserId))
                    throw new HubException("Geçersiz kullanıcı.");

                // Block kontrolü (her iki yönde de)
                var blocked = _db.FriendBlocks.Any(b =>
                    (b.BlockerUserId == fromUserId && b.BlockedUserId == toUserId) ||
                    (b.BlockerUserId == toUserId && b.BlockedUserId == fromUserId));
                if (blocked)
                    throw new HubException("Mesaj gönderilemez: kullanıcı engellendi.");

                // Arkadaşlık kontrolü
                var friends = _db.FriendRequests.Any(f =>
                    ((f.FromUserId == fromUserId && f.ToUserId == toUserId) || (f.FromUserId == toUserId && f.ToUserId == fromUserId))
                    && f.Status == FriendRequestStatus.Accepted);
                if (!friends)
                    throw new HubException("Önce arkadaş olunuz.");

                // Persist message (text)
                _db.ChatMessages.Add(new ChatMessage
                {
                    FromUserId = fromUserId,
                    ToUserId = toUserId,
                    Content = message
                });
                await _db.SaveChangesAsync();

                var payload = $"{fromUserId}:{message}";
                var pub = _redis.GetSubscriber();
                await pub.PublishAsync(RedisChannel.Literal($"chat:{toUserId}"), payload);
            }
            catch (RedisConnectionException ex)
            {
                _logger.LogError(ex, "Redis publish (private) sırasında bağlantı hatası");
                throw;
            }
        }

        // Attachment: base64 image data (small), content format: data:image/...;base64,....
        public async Task SendPrivateAttachment(string toUserId, string base64Data)
        {
            try
            {
                var fromUserId = Context.UserIdentifier ?? Context.User?.Identity?.Name ?? "";
                if (string.IsNullOrWhiteSpace(fromUserId) || string.IsNullOrWhiteSpace(toUserId))
                    throw new HubException("Geçersiz kullanıcı.");
                var blocked = _db.FriendBlocks.Any(b =>
                    (b.BlockerUserId == fromUserId && b.BlockedUserId == toUserId) ||
                    (b.BlockerUserId == toUserId && b.BlockedUserId == fromUserId));
                if (blocked) throw new HubException("Mesaj gönderilemez: kullanıcı engellendi.");
                if (!AreFriends(fromUserId, toUserId)) throw new HubException("Önce arkadaş olunuz.");

                var content = $"[img]{base64Data}"; // mark as image for client rendering
                _db.ChatMessages.Add(new ChatMessage { FromUserId = fromUserId, ToUserId = toUserId, Content = content });
                await _db.SaveChangesAsync();

                var payload = $"{fromUserId}:{content}";
                var pub = _redis.GetSubscriber();
                await pub.PublishAsync(RedisChannel.Literal($"chat:{toUserId}"), payload);
            }
            catch (RedisConnectionException ex)
            {
                _logger.LogError(ex, "Redis publish (attachment) sırasında bağlantı hatası");
                throw;
            }
        }

        // Location share: lat,lon numeric. Content will be [loc]lat,lon
        public async Task SendPrivateLocation(string toUserId, double latitude, double longitude)
        {
            try
            {
                var fromUserId = Context.UserIdentifier ?? Context.User?.Identity?.Name ?? "";
                if (string.IsNullOrWhiteSpace(fromUserId) || string.IsNullOrWhiteSpace(toUserId))
                    throw new HubException("Geçersiz kullanıcı.");
                if (IsBlockedEitherWay(fromUserId, toUserId)) throw new HubException("Mesaj gönderilemez: kullanıcı engellendi.");
                if (!AreFriends(fromUserId, toUserId)) throw new HubException("Önce arkadaş olunuz.");

                var content = $"[loc]{latitude},{longitude}";
                _db.ChatMessages.Add(new ChatMessage { FromUserId = fromUserId, ToUserId = toUserId, Content = content });
                await _db.SaveChangesAsync();

                var payload = $"{fromUserId}:{content}";
                var pub = _redis.GetSubscriber();
                await pub.PublishAsync(RedisChannel.Literal($"chat:{toUserId}"), payload);
            }
            catch (RedisConnectionException ex)
            {
                _logger.LogError(ex, "Redis publish (location) sırasında bağlantı hatası");
                throw;
            }
        }

        // ---- WebRTC Signaling for Video Calls (friends only) ----
        private bool AreFriends(string a, string b)
        {
            return _db.FriendRequests.Any(f =>
                ((f.FromUserId == a && f.ToUserId == b) || (f.FromUserId == b && f.ToUserId == a))
                && f.Status == FriendRequestStatus.Accepted);
        }

        private bool IsBlockedEitherWay(string a, string b)
        {
            return _db.FriendBlocks.Any(bk =>
                (bk.BlockerUserId == a && bk.BlockedUserId == b) ||
                (bk.BlockerUserId == b && bk.BlockedUserId == a));
        }

        public async Task RtcOffer(string toUserId, string offerSdpJson)
        {
            var fromUserId = Context.UserIdentifier ?? Context.User?.Identity?.Name ?? "";
            if (string.IsNullOrWhiteSpace(fromUserId) || string.IsNullOrWhiteSpace(toUserId))
                throw new HubException("Geçersiz kullanıcı.");
            if (IsBlockedEitherWay(fromUserId, toUserId))
                throw new HubException("Görüntülü çağrı engellendi.");
            if (!AreFriends(fromUserId, toUserId))
                throw new HubException("Önce arkadaş olunuz.");
            await Clients.User(toUserId).SendAsync("RtcOffer", fromUserId, offerSdpJson);
        }

        public async Task RtcAnswer(string toUserId, string answerSdpJson)
        {
            var fromUserId = Context.UserIdentifier ?? Context.User?.Identity?.Name ?? "";
            if (string.IsNullOrWhiteSpace(fromUserId) || string.IsNullOrWhiteSpace(toUserId))
                throw new HubException("Geçersiz kullanıcı.");
            if (IsBlockedEitherWay(fromUserId, toUserId))
                throw new HubException("Görüntülü çağrı engellendi.");
            if (!AreFriends(fromUserId, toUserId))
                throw new HubException("Önce arkadaş olunuz.");
            await Clients.User(toUserId).SendAsync("RtcAnswer", fromUserId, answerSdpJson);
        }

        public async Task RtcIceCandidate(string toUserId, string candidateJson)
        {
            var fromUserId = Context.UserIdentifier ?? Context.User?.Identity?.Name ?? "";
            if (string.IsNullOrWhiteSpace(fromUserId) || string.IsNullOrWhiteSpace(toUserId))
                throw new HubException("Geçersiz kullanıcı.");
            if (IsBlockedEitherWay(fromUserId, toUserId) || !AreFriends(fromUserId, toUserId))
                return; // sessizce yok say
            await Clients.User(toUserId).SendAsync("RtcIceCandidate", fromUserId, candidateJson);
        }

        public async Task RtcHangup(string toUserId)
        {
            var fromUserId = Context.UserIdentifier ?? Context.User?.Identity?.Name ?? "";
            if (string.IsNullOrWhiteSpace(fromUserId) || string.IsNullOrWhiteSpace(toUserId))
                return;
            if (IsBlockedEitherWay(fromUserId, toUserId) || !AreFriends(fromUserId, toUserId))
                return;
            await Clients.User(toUserId).SendAsync("RtcHangup", fromUserId);
        }

    public override Task OnConnectedAsync() => base.OnConnectedAsync();
    }
}
