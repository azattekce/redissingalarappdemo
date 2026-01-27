namespace RedisChatApp.Models
{
    public record RegisterRequest(string email, string password, string? displayName);
    public record LoginRequest(string email, string password);
    public record FriendRequestCreate(string toUserId);
    public record FriendRespondRequest(int requestId, bool accept);
    public record ForgotPasswordRequest(string email);
    
    // Admin Panel Request Models
    public record CreateUserRequest(string Email, string DisplayName, string Password);
    public record UpdateUserRequest(string Email, string DisplayName, string? Password);
    public record LockUserRequest(int LockoutDays);
}
