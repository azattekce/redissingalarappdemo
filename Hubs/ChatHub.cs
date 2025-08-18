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

                // Persist message
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

    public override Task OnConnectedAsync() => base.OnConnectedAsync();
    }
}
