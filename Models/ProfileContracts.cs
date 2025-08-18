namespace RedisChatApp.Models
{
    public record PasswordChangeRequest(string currentPassword, string newPassword);
    public record IdRequest(string userId);
    public class UpdateProfileRequest
    {
        public string? DisplayName { get; set; }
        public string? PhoneNumber { get; set; }
        public UserProfile? Profile { get; set; }
    }
}
