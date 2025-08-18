using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StackExchange.Redis;
using RedisChatApp.Hubs;

namespace RedisChatApp.Services
{
    public class ChatRedisSubscriber : IHostedService
    {
        private readonly IConnectionMultiplexer _redis;
        private readonly IHubContext<ChatHub> _hubContext;
        private readonly ILogger<ChatRedisSubscriber> _logger;
    private ISubscriber? _subscriber;

        public ChatRedisSubscriber(IConnectionMultiplexer redis, IHubContext<ChatHub> hubContext, ILogger<ChatRedisSubscriber> logger)
        {
            _redis = redis;
            _hubContext = hubContext;
            _logger = logger;
        }

        public async Task StartAsync(CancellationToken cancellationToken)
        {
            try
            {
                _subscriber = _redis.GetSubscriber();
                // Private messages: subscribe pattern chat:{userId}
                await _subscriber.SubscribeAsync(RedisChannel.Pattern("chat:*"), async (channel, message) =>
                {
                    var channelName = channel.ToString(); // e.g., chat:USERID
                    var parts = channelName.Split(':', 2);
                    if (parts.Length == 2)
                    {
                        var userId = parts[1];
                        await _hubContext.Clients.User(userId).SendAsync("ReceivePrivateMessage", message.ToString(), cancellationToken);
                    }
                });
                _logger.LogInformation("Subscribed to Redis channel pattern 'chat:*'.");
            }
            catch (RedisConnectionException ex)
            {
                _logger.LogError(ex, "Failed to subscribe to Redis channel at startup.");
            }
        }

        public async Task StopAsync(CancellationToken cancellationToken)
        {
            if (_subscriber != null)
            {
                try
                {
                    await _subscriber.UnsubscribeAsync(RedisChannel.Literal("chat_channel"));
                }
                catch (RedisConnectionException ex)
                {
                    _logger.LogWarning(ex, "Error while unsubscribing from Redis channel on shutdown.");
                }
            }
        }
    }
}
