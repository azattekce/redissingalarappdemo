namespace RedisChatApp.Models
{
    public record RegisterRequest(string email, string password, string? displayName);
    public record LoginRequest(string email, string password);
    public record FriendRequestCreate(string toUserId);
    public record FriendRespondRequest(int requestId, bool accept);
}
