using System.ComponentModel.DataAnnotations;

namespace RedisChatApp.Models
{
    public class UserProfile
    {
        [Key]
        public int Id { get; set; }
        [Required]
        public string UserId { get; set; } = default!; // FK to AspNetUsers

        public string? AvatarUrl { get; set; }
        public string? Gender { get; set; } // "Erkek", "Kadın", "Diğer" vs.
        public string? Address { get; set; }
        public string? Education { get; set; }

        public bool PhonePublic { get; set; }
        public bool AddressPublic { get; set; }
    }
}
